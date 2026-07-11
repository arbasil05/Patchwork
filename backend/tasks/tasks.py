import base64
import docker
from .pool.pool_manager import acquire_container, release_container

docker_client = docker.from_env()

FRAMEWORK_COMMANDS = {
    "django": "pytest",
    "express": "npx jest"
}


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

    try:
        container = docker_client.containers.get(container_id)

        # 1. Clean workspace (in case a previous job left artifacts)
        container.exec_run(["sh", "-c", "rm -rf /workspace/*"])

        # 2. Write project files into the container
        write_files_to_container(container, project_files)

        # 3. Verify files landed (debug — can be removed later)
        _, ls_output = container.exec_run(["ls", "-la", "/workspace"])
        print(f"[Runner] /workspace contents:\n{ls_output.decode()}")

        # 4. Execute the test suite
        exit_code, output = container.exec_run(
            ["sh", "-c", command],
            workdir="/workspace"
        )

        # 5. Clean up workspace before releasing
        container.exec_run(["sh", "-c", "rm -rf /workspace/*"])

        return {
            "exit_code": exit_code,
            "stdout": output.decode("utf-8", errors="replace"),
        }
    except Exception as e:
        return {"error": f"Execution failed: {str(e)}"}
    finally:
        # 6. Always release container back to the idle pool
        release_container(framework, container_id)