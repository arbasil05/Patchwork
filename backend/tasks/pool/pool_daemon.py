import time
import docker
import redis
from pool_manager import provision_new_container, FRAMEWORK_IMAGES, _get_idle_key, _get_busy_key

redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)
docker_client = docker.from_env()

TARGET_BUFFER = 5
MAX_POOL_SIZE = 50
CHECK_INTERVAL = 2

def get_pool_metrics(framework):
    idle_count = redis_client.scard(_get_idle_key(framework))
    busy_count = redis_client.scard(_get_busy_key(framework))
    return idle_count, busy_count

def scale_up_pool(framework, idle_count, total_containers):
    if idle_count < TARGET_BUFFER:
        needed = TARGET_BUFFER - idle_count
        available_slots = MAX_POOL_SIZE - total_containers
        to_spawn = min(needed, available_slots)

        if to_spawn > 0:
            print(f"[Daemon][{framework}] Pool low! Idle: {idle_count}/{TARGET_BUFFER}. Scaling up by {to_spawn}...")
            for _ in range(to_spawn):
                try:
                    provision_new_container(framework)
                except Exception as e:
                    print(f"[Daemon][{framework}] Failed to provision container: {e}")
                    break # Stop trying if Docker daemon is struggling

def scale_down_pool(framework, idle_count, busy_count):
    # When fully idle: enforce exactly TARGET_BUFFER containers
    # When jobs are running: allow a cushion to avoid over-reaping
    target = TARGET_BUFFER if busy_count == 0 else TARGET_BUFFER + 5

    if idle_count > target:
        excess = idle_count - target
        print(f"[Daemon][{framework}] {'Idle-only trim' if busy_count == 0 else 'Pool saturated'}. Idle: {idle_count} → {target}. Reaping {excess} containers...")

        idle_key = _get_idle_key(framework)
        for _ in range(excess):
            container_id = redis_client.spop(idle_key)
            if not container_id:
                break

            try:
                container = docker_client.containers.get(container_id)
                container.kill()
                print(f"[Daemon][{framework}] Successfully reaped container: {container_id}")
            except docker.errors.NotFound:
                pass
            except Exception as e:
                print(f"[Daemon][{framework}] Error tearing down container {container_id}: {e}")

def reconcile_orphans(framework):
    """On startup, kill any {framework}_ containers that Docker knows about but Redis doesn't."""
    idle_key = _get_idle_key(framework)
    busy_key = _get_busy_key(framework)
    known_ids = redis_client.smembers(idle_key) | redis_client.smembers(busy_key)
    
    # Filter by the framework prefix configured in pool_manager
    all_runner_containers = docker_client.containers.list(filters={"name": f"{framework}_"})

    orphans = [c for c in all_runner_containers if c.name not in known_ids]

    if orphans:
        print(f"[Daemon][{framework}] Found {len(orphans)} orphaned container(s) not in Redis. Reaping...")
        for c in orphans:
            try:
                c.kill()
                print(f"[Daemon][{framework}] Reaped orphan: {c.name}")
            except Exception as e:
                print(f"[Daemon][{framework}] Failed to reap orphan {c.name}: {e}")
    else:
        print(f"[Daemon][{framework}] No orphaned containers found.")

def run_daemon():
    print(f"[Daemon] Preemptive scaling daemon started. Target Buffer: {TARGET_BUFFER}, Max Capacity: {MAX_POOL_SIZE} (per framework)")
    print(f"[Daemon] Supported frameworks: {', '.join(FRAMEWORK_IMAGES.keys())}")

    # Reconcile orphans for all frameworks on startup
    for framework in FRAMEWORK_IMAGES:
        reconcile_orphans(framework)

    while True:
        try:
            # Iterate through every framework and evaluate scaling independently
            for framework in FRAMEWORK_IMAGES:
                idle_count, busy_count = get_pool_metrics(framework)
                total_containers = idle_count + busy_count
                
                # Check Scale Up Condition
                scale_up_pool(framework, idle_count, total_containers)

                # Check Scale Down Condition
                scale_down_pool(framework, idle_count, busy_count)
            
        except Exception as e:
            print(f"[Daemon] Loop error: {e}")
            
        time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    run_daemon()
