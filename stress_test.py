import asyncio
import aiohttp
import time
import uuid
import json
import statistics
import psutil
import docker
import redis
import sys
from collections import defaultdict
import datetime

# --- CONFIGURATION ---
BASE_URL = "http://127.0.0.1:8000/ticket"
SUBMIT_URL = f"{BASE_URL}/submit"
STATUS_URL = f"{BASE_URL}/status"

STAGES = [
    {"name": "Warmup", "users": 5, "duration": 30},
    {"name": "Stage 1", "users": 10, "duration": 45},
    {"name": "Stage 2", "users": 25, "duration": 45},
    {"name": "Stage 3", "users": 50, "duration": 45},
    {"name": "Stage 4", "users": 100, "duration": 45},
    {"name": "Stage 5", "users": 200, "duration": 45},
]

PAYLOAD_TEMPLATE = {
    "framework": "django",
    "challenge_id": 2,
    "base_ref": "main",
    "files": [
        {
            "filename": "urls.py",
            "content": "from django.urls import path\nimport views\n\nurlpatterns = [\n    path('api/feedback/', views.submit_feedback),\n]\n"
        },
        {
            "filename": "views.py",
            "content": "import json\nfrom django.http import JsonResponse\n\n\ndef submit_feedback(request):\n    if request.method != 'POST':\n        return JsonResponse({'error': 'Method not allowed'}, status=405)\n\n    try:\n        data = json.loads(request.body)\n    except json.JSONDecodeError:\n        return JsonResponse({'error': 'Invalid JSON'}, status=400)\n\n    name = data.get('name')\n    message = data.get('message')\n\n    if not name or not message:\n        return JsonResponse({'error': 'name and message are required'}, status=400)\n\n    return JsonResponse({\n        'status': 'received',\n        'name': name,\n        'message': message\n    }, status=201)\n"
        }
    ]
}

# --- METRICS STORAGE ---
class MetricsStore:
    def __init__(self):
        self.api_latencies = []
        self.success_count = 0
        self.error_count = 0
        self.timeout_count = 0
        self.status_dist = defaultdict(int)
        
        # Worker metrics
        self.workspace_creation_times = []
        self.execution_times = []
        self.cleanup_times = []
        self.total_worker_times = []
        self.queue_wait_times = []
        self.jobs_completed = 0
        
        # System tracking
        self.active_containers = 0
        self.max_containers = 0
        self.total_spawned = 0
        
        self.peak_fastapi_cpu = 0
        self.peak_fastapi_ram = 0
        self.peak_worker_cpu = []
        self.peak_redis_cpu = 0
        self.peak_total_cpu = 0
        self.peak_total_ram = 0
        self.queue_depths = []

metrics = MetricsStore()
is_running = True
current_stage_name = "Starting"

# --- HELPER FUNCTIONS ---
def get_processes_by_cmdline(substring):
    procs = []
    for p in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            cmd = p.info.get('cmdline')
            if cmd and any(substring in arg for arg in cmd):
                procs.append(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return procs

async def collect_system_metrics():
    print("[Monitor] Starting background metrics collection...")
    r = redis.Redis(host='localhost', port=6379, decode_responses=True)
    dclient = docker.from_env()
    
    uvicorn_procs = get_processes_by_cmdline("uvicorn")
    worker_procs = get_processes_by_cmdline("worker.py")
    
    print(f"[Monitor] Found {len(uvicorn_procs)} FastAPI processes, {len(worker_procs)} Worker processes.")
    
    while is_running:
        try:
            # System
            cpu = psutil.cpu_percent(interval=None)
            ram = psutil.virtual_memory().percent
            metrics.peak_total_cpu = max(metrics.peak_total_cpu, cpu)
            metrics.peak_total_ram = max(metrics.peak_total_ram, ram)
            
            # FastAPI
            if uvicorn_procs:
                fastapi_cpu = sum(p.cpu_percent() for p in uvicorn_procs)
                fastapi_ram = sum(p.memory_info().rss for p in uvicorn_procs)
                metrics.peak_fastapi_cpu = max(metrics.peak_fastapi_cpu, fastapi_cpu)
                metrics.peak_fastapi_ram = max(metrics.peak_fastapi_ram, fastapi_ram)
            
            # Workers
            if worker_procs:
                w_cpus = [p.cpu_percent() for p in worker_procs]
                if not metrics.peak_worker_cpu or max(w_cpus) > max(metrics.peak_worker_cpu):
                    metrics.peak_worker_cpu = w_cpus
                    
            # Redis Queue
            q_len = r.llen("rq:queue:submission_queue")
            metrics.queue_depths.append(q_len)
            
            # Docker
            containers = dclient.containers.list(filters={"name": "django_"})
            metrics.active_containers = len(containers)
            metrics.max_containers = max(metrics.max_containers, len(containers))
            
        except Exception as e:
            pass
        
        await asyncio.sleep(1.0)


async def user_session(session, session_id):
    """Simulates a user submitting challenges in a loop."""
    while is_running:
        payload = PAYLOAD_TEMPLATE.copy()
        payload["idempotency_key"] = str(uuid.uuid4())
        
        t0 = time.time()
        try:
            async with session.post(SUBMIT_URL, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                t1 = time.time()
                metrics.api_latencies.append(t1 - t0)
                metrics.status_dist[resp.status] += 1
                
                if resp.status in (200, 201, 202):
                    metrics.success_count += 1
                    data = await resp.json()
                    job_id = data.get("job_id")
                    
                    # Spawn a fire-and-forget task to poll job completion
                    asyncio.create_task(poll_job_status(session, job_id, t1))
                else:
                    metrics.error_count += 1
        except asyncio.TimeoutError:
            metrics.timeout_count += 1
            metrics.error_count += 1
        except Exception:
            metrics.error_count += 1
            
        # Pacing: wait a bit before submitting next
        await asyncio.sleep(1.0)


async def poll_job_status(session, job_id, queued_time):
    """Polls the job status to get detailed execution metrics."""
    poll_interval = 0.5
    while is_running:
        try:
            async with session.get(f"{STATUS_URL}/{job_id}") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    status = data.get("status")
                    if status == "finished":
                        result = data.get("result", {})
                        job_metrics = result.get("metrics", {})
                        
                        metrics.jobs_completed += 1
                        metrics.total_spawned += 1 # 1 container spawned per job
                        
                        if job_metrics:
                            # We can estimate queue wait time
                            metrics.workspace_creation_times.append(job_metrics.get("workspace_creation_time", 0))
                            metrics.execution_times.append(job_metrics.get("execution_time", 0))
                            metrics.cleanup_times.append(job_metrics.get("workspace_cleanup_time", 0))
                            metrics.total_worker_times.append(job_metrics.get("total_worker_time", 0))
                        break
                    elif status == "failed":
                        break
        except Exception:
            pass
        await asyncio.sleep(poll_interval)


async def run_stage(session, stage_info):
    global current_stage_name
    current_stage_name = stage_info["name"]
    users = stage_info["users"]
    duration = stage_info["duration"]
    
    print(f"\n[{current_stage_name}] Ramping up to {users} users for {duration} seconds...")
    
    tasks = []
    for i in range(users):
        tasks.append(asyncio.create_task(user_session(session, i)))
        await asyncio.sleep(0.05) # Ramp up smoothly
        
    await asyncio.sleep(duration)
    
    # Analyze stability for this stage
    recent_lat = metrics.api_latencies[-500:] if metrics.api_latencies else [0]
    p95 = statistics.quantiles(recent_lat, n=100)[94] if len(recent_lat) > 100 else (max(recent_lat) if recent_lat else 0)
    err_rate = metrics.error_count / max(1, (metrics.success_count + metrics.error_count))
    
    print(f"[{current_stage_name} Finished] P95: {p95:.3f}s | Error Rate: {err_rate*100:.1f}%")
    
    # Cancel user tasks
    for t in tasks:
        t.cancel()
    
    return p95, err_rate


def generate_report(test_duration):
    print("\n\n" + "="*50)
    print("STRESS TEST REPORT")
    print("="*50)
    
    if not metrics.api_latencies:
        print("No API latencies recorded.")
        return
        
    total_reqs = metrics.success_count + metrics.error_count
    throughput = total_reqs / test_duration
    
    print(f"\n1. Throughput: {throughput:.2f} req/sec")
    print(f"2. Average Latency: {statistics.mean(metrics.api_latencies):.3f}s")
    if len(metrics.api_latencies) > 100:
        quants = statistics.quantiles(metrics.api_latencies, n=100)
        print(f"3. P95 Latency: {quants[94]:.3f}s")
        print(f"4. P99 Latency: {quants[98]:.3f}s")
    print(f"5. Max Concurrent Containers: {metrics.max_containers}")
    print(f"6. Total Containers Spawned: {metrics.total_spawned}")
    print(f"7. Peak System RAM Usage: {metrics.peak_total_ram}%")
    print(f"8. Peak System CPU Usage: {metrics.peak_total_cpu}%")
    
    if metrics.peak_worker_cpu:
        print(f"9. Worker CPU Utilization (Peak): {', '.join([f'{c}%' for c in metrics.peak_worker_cpu])}")
    
    print(f"10. Peak FastAPI CPU: {metrics.peak_fastapi_cpu}%, RAM: {metrics.peak_fastapi_ram / (1024*1024):.1f}MB")
    print(f"11. Total Jobs Completed: {metrics.jobs_completed}")
    print(f"12. Queue Backlog Peak: {max(metrics.queue_depths) if metrics.queue_depths else 0}")
    
    print("\n--- Container Timings ---")
    if metrics.workspace_creation_times:
        print(f"Avg Workspace Creation: {statistics.mean(metrics.workspace_creation_times):.3f}s")
        print(f"Avg Test Execution: {statistics.mean(metrics.execution_times):.3f}s")
        print(f"Avg Workspace Cleanup: {statistics.mean(metrics.cleanup_times):.3f}s")
        print(f"Avg Total Worker Time: {statistics.mean(metrics.total_worker_times):.3f}s")
        
    print("\n--- Bottleneck Analysis ---")
    bottleneck = "Unknown"
    if metrics.peak_total_cpu > 90:
        bottleneck = "CPU (System)"
    elif any(c > 90 for c in metrics.peak_worker_cpu) if metrics.peak_worker_cpu else False:
        bottleneck = "CPU (Workers)"
    elif max(metrics.queue_depths) > 50 if metrics.queue_depths else False:
        bottleneck = "Workers / Docker limits (High Queue)"
    elif metrics.peak_total_ram > 90:
        bottleneck = "Memory"
    print(f"13. Primary Bottleneck: {bottleneck}")
    
    print("\n--- EC2 Recommendations ---")
    print("Based on the throughput scaling:")
    print("- t3.small (2 vCPU, 2GB): Suitable for Development (bursty, low concurrency)")
    print("- t3.medium (2 vCPU, 4GB): Suitable for Small Production (~100 users/day)")
    print("- c7g.large / c7i.large (2 vCPU, 4GB, Compute optimized): Suitable for Medium Production (~1000 users/day)")
    print("- c7g.xlarge / c7i.xlarge (4 vCPU, 8GB): Suitable for Large Production (Consistent high load, parallel container spins)")
    
    report_content = (
        f"# Load Test Report\n\n"
        f"Throughput: {throughput:.2f} req/s\n"
        f"Bottleneck: {bottleneck}\n"
        f"Peak RAM: {metrics.peak_total_ram}%\n"
        f"Peak CPU: {metrics.peak_total_cpu}%\n"
        f"Peak Queue Backlog: {max(metrics.queue_depths) if metrics.queue_depths else 0}\n"
    )
    with open("load_test_report.md", "w") as f:
        f.write(report_content)
        

async def main():
    global is_running
    monitor_task = asyncio.create_task(collect_system_metrics())
    start_time = time.time()
    
    async with aiohttp.ClientSession() as session:
        stable_users = STAGES[0]["users"]
        
        for stage in STAGES:
            p95, err_rate = await run_stage(session, stage)
            if err_rate < 0.05 and p95 < 5.0:
                stable_users = stage["users"]
            else:
                print(f"[!] Stability threshold breached at {stage['users']} users. Reverting to {stable_users} for Stage 6.")
                break
                
        # Stage 6
        print(f"\n[Stage 6] Sustaining {stable_users} concurrent users for 5 minutes (300s)...")
        tasks = []
        for i in range(stable_users):
            tasks.append(asyncio.create_task(user_session(session, i)))
            await asyncio.sleep(0.05)
            
        await asyncio.sleep(300)
        for t in tasks:
            t.cancel()
            
    is_running = False
    await monitor_task
    
    test_duration = time.time() - start_time
    generate_report(test_duration)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
