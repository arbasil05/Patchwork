import os
import httpx
from typing import List, Dict, Optional
from pydantic import BaseModel

class ChallengeModel(BaseModel):
    title: str
    description: str
    editable_files: List[str]
    files: Dict[str, str]

async def get_challenge(framework: str, challenge_id: int) -> Optional[ChallengeModel]:
    """
    Fetches the challenge JSON from the GitHub repository.
    Converts the {"files": [{"filename": "...", "content": "..."}]} array
    into a dictionary mapping filename -> content for easier access in tickets.py.
    """
    repo = os.getenv("CHALLENGE_REPO", "arbasil05/patchwork-Questions")
    branch = os.getenv("CHALLENGE_BRANCH", "main")
    
    filename = f"{framework}-{challenge_id}.json"
    url = f"https://raw.githubusercontent.com/{repo}/{branch}/{framework}/{filename}"
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url)
            
            if response.status_code != 200:
                print(f"[GithubService] Failed to fetch {url}: HTTP {response.status_code}")
                return None
                
            data = response.json()
            
            # The JSON array format: "files": [{"filename": "...", "content": "..."}]
            # Convert this to a dictionary: {"manage.py": "...", "models.py": "..."}
            files_dict = {}
            for f in data.get("files", []):
                file_name = f.get("filename")
                content = f.get("content", "")
                if file_name:
                    files_dict[file_name] = content
                    
            # If the JSON includes an "editable_files" array, use it.
            # Otherwise, default to allowing ALL files in the challenge to be edited.
            editable_files = data.get("editable_files", list(files_dict.keys()))
            
            title = data.get("title", "")
            description = data.get("description", "")
            
            return ChallengeModel(
                title=title,
                description=description,
                editable_files=editable_files,
                files=files_dict
            )
            
        except Exception as e:
            print(f"[GithubService] Error fetching challenge {challenge_id}: {e}")
            return None