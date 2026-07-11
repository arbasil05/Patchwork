from tasks.tasks import run_submission
from fastapi import HTTPException
from services import github_service
from schema.ticketSchema import SubmissionRequest
from fastapi import APIRouter
from redis.asyncio import Redis as AsyncRedis
from redis import Redis as SyncRedis
from rq import Queue
from rq.job import Job

redis_conn = AsyncRedis(host="localhost", port=6379)
sync_redis_conn = SyncRedis(host="localhost", port=6379)
task_queue = Queue("submission_queue", connection=sync_redis_conn)

router = APIRouter(prefix="/ticket",tags=["ticket"])


@router.get("/health")
def health_check():
    return {"status": "ok"}


@router.post("/submit")
async def submit_ticket(req:SubmissionRequest):
    idempotency_key = str(req.idempotency_key)

    was_new = await redis_conn.set(f"idempotency:{idempotency_key}", "pending", ex=60*60*24*2, nx=True)

    if not was_new:
        return {
            "ticket_id": idempotency_key,
            "message": "Already exists"
        }

    challenge = await github_service.get_challenge(req.challenge_id)

    if challenge is None:
        raise HTTPException(
            status_code=404,
            detail="challenge not found"
        )
    
    allowed = set(challenge.editable_files)

    for file in req.files:
        if file.filename not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"{file.filename} is not editable"
            )
    
    project = challenge.files

    for file in req.files:
        project[file.filename] = file.content
    
    job = task_queue.enqueue(
        run_submission,
        project
    )

    await redis_conn.set(f"idempotency:{idempotency_key}", job.id, ex=60*60*24*2)

    return {
        "message": "Submission queued",
        "job_id": job.id,
        "ticket_id": idempotency_key
    }
    
@router.get("/status/{job_id}")
def get_status(job_id):
    try:
        job = Job.fetch(job_id, connection=sync_redis_conn)
        return {
            "status": job.get_status(),
            "result": job.result
        }
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail="job not found"
        )
    
    

