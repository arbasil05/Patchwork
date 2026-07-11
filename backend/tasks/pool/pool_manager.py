import uuid
import docker
from redis import Redis
import time
import random

redis_client = Redis(host="localhost", port=6379, decode_responses=True)
docker_client = docker.from_env()

FRAMEWORK_IMAGES = {
    "django": "patchwork-django:latest",
    "express": "patchwork-express:latest",
}


def _get_idle_key(framework):
    return f"pool:{framework}:idle"


def _get_busy_key(framework):
    return f"pool:{framework}:busy"


def _validate_framework(framework):
    if framework not in FRAMEWORK_IMAGES:
        raise ValueError(
            f"Unknown framework '{framework}'. "
            f"Available: {', '.join(FRAMEWORK_IMAGES)}"
        )


def provision_new_container(framework):
    _validate_framework(framework)

    image = FRAMEWORK_IMAGES[framework]
    container_id = f"{framework}_{uuid.uuid4().hex[:8]}"

    run_kwargs = {
        "image": image,
        # this command will keep the container running forever
        "command": ["sh", "-c", "tail -f /dev/null"],
        "name": container_id,
        "detach": True,
        "remove": True,
        "network_disabled": True,
        "mem_limit": "256m",
        "pids_limit": 256,
    }

    if framework == "express":
        # Express needs the pre-installed node_modules inside /workspace to be visible.
        # We cannot mount an empty tmpfs over it. To allow writing submission files,
        # we must disable read_only for this framework.
        run_kwargs["read_only"] = False
        run_kwargs["tmpfs"] = {'/tmp': 'exec'}
    else:
        # Python frameworks don't need dependencies in /workspace, so they can use
        # a strict read-only root with an empty tmpfs for the workspace.
        run_kwargs["read_only"] = True
        run_kwargs["tmpfs"] = {'/tmp': 'exec', '/workspace': 'exec,size=64m,uid=1000,gid=1000'}

    container = docker_client.containers.run(**run_kwargs)

    redis_client.sadd(_get_idle_key(framework), container_id)
    print(f"[Pool] Provisioned {framework} warm container: {container_id}")
    return container_id


def acquire_container(framework, timeout_seconds=10):
    _validate_framework(framework)

    idle_key = _get_idle_key(framework)
    busy_key = _get_busy_key(framework)
    start_time = time.time()

    while time.time() - start_time < timeout_seconds:

        container_id = redis_client.srandmember(idle_key)

        if container_id:
            success = redis_client.smove(idle_key, busy_key, container_id)
            if success:
                return container_id

        time.sleep(random.uniform(0.05, 0.2))
    raise TimeoutError(f"Timeout: No warm {framework} containers became available in time.")


def release_container(framework, container_id):
    _validate_framework(framework)

    redis_client.smove(_get_busy_key(framework), _get_idle_key(framework), container_id)
    print(f"[Pool] Container {container_id} returned to {framework} idle pool.")
