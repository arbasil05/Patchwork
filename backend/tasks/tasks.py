import base64
import docker
import time
from .pool.pool_manager import acquire_container, release_container

docker_client = docker.from_env()

FRAMEWORK_COMMANDS = {
    "django": "pytest",
    "fastapi": "pytest",
    "flask": "pytest",
    "express": "npx jest --runInBand --ci",
}

def cleanup_submission_files(container, project_files: dict) -> None:
    """
    Deletes only the files that were written for this submission.

    This is safer and simpler than a broad workspace wipe:
    - It works identically for all frameworks (no branching needed).
    - Python: site-packages live outside /workspace anyway, so a full
      wipe would also work — but targeting exact files is cleaner.
    - Express: node_modules, package.json, and package-lock.json are
      never in project_files, so they are naturally left untouched.
    """
    for filename in project_files:
        exit_code, output = container.exec_run(["rm", "-rf", f"/workspace/{filename}"])
        if exit_code != 0:
            raise RuntimeError(
                f"Failed to clean up {filename}: "
                f"{output.decode('utf-8', errors='replace')}"
            )


def write_files_to_container(container, project_files: dict) -> None:
    """
    Writes each project file into the container's /workspace directory.
    Uses base64 encoding per file to avoid shell-escaping issues.
    """
    for filename, content in project_files.items():
        b64 = base64.b64encode(content.encode("utf-8")).decode("utf-8")
        cmd = f"echo '{b64}' | base64 -d > /workspace/{filename}"
        exit_code, output = container.exec_run(["sh", "-c", cmd])
        if exit_code != 0:
            raise RuntimeError(
                f"Failed to write {filename}: {output.decode('utf-8', errors='replace')}"
            )


def run_submission(framework: str, project_files: dict) -> dict:
    """
    Executes a user submission securely inside a warm Docker container.
    """
    command = FRAMEWORK_COMMANDS.get(framework)
    if not command:
        return {"error": f"Unsupported framework: {framework}"}

    try:
        container_id = acquire_container(framework)
    except Exception as e:
        return {"error": f"Failed to acquire container: {str(e)}"}

    metrics = {}
    total_start = time.time()
    try:
        container = docker_client.containers.get(container_id)

        t0 = time.time()
        # 1. Remove any leftover submission files from a previous run
        cleanup_submission_files(container, project_files)

        # 2. Write project files into the container
        write_files_to_container(container, project_files)
        t1 = time.time()
        metrics["workspace_creation_time"] = t1 - t0

        # 3. Verify files landed (debug — can be removed later)
        _, ls_output = container.exec_run(["ls", "-la", "/workspace"])
        # print(f"[Runner] /workspace contents:\n{ls_output.decode()}")

        # 4. Execute the test suite
        t2 = time.time()
        exit_code, output = container.exec_run(
            ["sh", "-c", command],
            workdir="/workspace"
        )
        t3 = time.time()
        metrics["execution_time"] = t3 - t2

        # 5. Remove submission files before releasing the container
        t4 = time.time()
        cleanup_submission_files(container, project_files)
        t5 = time.time()
        metrics["workspace_cleanup_time"] = t5 - t4
        metrics["total_worker_time"] = t5 - total_start

        return {
            "exit_code": exit_code,
            "stdout": output.decode("utf-8", errors="replace"),
            "metrics": metrics
        }
    except Exception as e:
        return {"error": f"Execution failed: {str(e)}"}
    finally:
        # 6. Always release container back to the idle pool
        release_container(framework, container_id)