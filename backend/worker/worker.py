from redis import Redis as SyncRedis
from rq import SimpleWorker,Queue

redis_con = SyncRedis(host="localhost", port=6379)

if __name__ == "__main__":
    worker = SimpleWorker(queues=["submission_queue"],connection=redis_con)
    worker.work()