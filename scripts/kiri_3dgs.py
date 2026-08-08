#!/usr/bin/env python3
"""
Test script for KIRI Engine's 3D Gaussian Splatting API.
Uploads a video, polls until processing completes, and downloads the result.

Same pipeline the app's /capture page drives, without a browser — useful for
seeding places ahead of a demo, since reconstruction takes 30-90 minutes.

Setup:
    pip install requests

Usage:
    python scripts/kiri_3dgs.py --video path/to/video.mp4
    python scripts/kiri_3dgs.py --video path/to/video.mp4 --include-mesh
    python scripts/kiri_3dgs.py --serialize TASK_ID        # resume, no re-upload

The task ID printed on upload can also be pasted into /capture to render the
finished splat in the app.
"""

import argparse
import os
import sys
import time
import requests

BASE_URL = "https://api.kiriengine.app/api/v1/open"

STATUS_LABELS = {
    -1: "Uploading",
    0: "Processing",
    1: "Failed",
    2: "Successful",
    3: "Queuing",
    4: "Expired",
}


def load_api_key():
    """Return the API key from the environment, falling back to the app's env files."""
    key = os.environ.get("KIRI_API_KEY")
    if key:
        return key
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for filename in (".env.local", ".env"):
        try:
            with open(os.path.join(repo_root, filename)) as f:
                for line in f:
                    name, _, value = line.strip().partition("=")
                    if name == "KIRI_API_KEY" and value.strip():
                        return value.strip().strip("'\"")
        except FileNotFoundError:
            continue
    return None


def upload_video(api_key, video_path, include_mesh):
    url = f"{BASE_URL}/3dgs/video"
    headers = {"Authorization": f"Bearer {api_key}"}
    data = {"isMesh": "1" if include_mesh else "0", "isMask": "0"}
    with open(video_path, "rb") as f:
        files = {"videoFile": f}
        resp = requests.post(url, headers=headers, data=data, files=files)
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("ok"):
        raise RuntimeError(f"Upload failed: {payload}")
    return payload["data"]["serialize"]


def check_status(api_key, serialize, retries=10):
    """Poll task status, tolerating transient network failures so a blip doesn't kill a long job."""
    url = f"{BASE_URL}/model/getStatus"
    headers = {"Authorization": f"Bearer {api_key}"}
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=headers, params={"serialize": serialize}, timeout=30)
            resp.raise_for_status()
            return resp.json()["data"]["status"]
        except (requests.ConnectionError, requests.Timeout) as e:
            wait = min(60, 5 * (attempt + 1))
            print(f"Network error ({e.__class__.__name__}), retrying in {wait}s...", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"Lost connection for too long. Resume with --serialize {serialize}")


def get_download_url(api_key, serialize):
    url = f"{BASE_URL}/model/getModelZip"
    headers = {"Authorization": f"Bearer {api_key}"}
    resp = requests.get(url, headers=headers, params={"serialize": serialize})
    resp.raise_for_status()
    return resp.json()["data"]["modelUrl"]


def download_file(url, out_path):
    resp = requests.get(url, stream=True)
    resp.raise_for_status()
    with open(out_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)


def main():
    parser = argparse.ArgumentParser(description="Upload a video to KIRI's 3DGS API and download the resulting splat")
    parser.add_argument("--api-key", help="Your KIRI Engine API key (defaults to KIRI_API_KEY env var or .env)")
    parser.add_argument("--video", help="Path to a video (<=1920x1080, <=3 min)")
    parser.add_argument("--serialize", help="Resume an already-uploaded task by its ID instead of uploading")
    parser.add_argument("--include-mesh", action="store_true", help="Also generate an OBJ mesh alongside the splat")
    parser.add_argument("--out", default="splat_result.zip", help="Where to save the downloaded zip")
    parser.add_argument("--poll-interval", type=int, default=15, help="Seconds between status checks")
    args = parser.parse_args()

    api_key = args.api_key or load_api_key()
    if not api_key:
        parser.error("No API key. Pass --api-key, set KIRI_API_KEY, or add it to .env")

    if args.serialize:
        serialize = args.serialize
        print(f"Resuming task {serialize} (no re-upload)", flush=True)
    elif args.video:
        print("Uploading video...", flush=True)
        serialize = upload_video(api_key, args.video, args.include_mesh)
        print(f"Uploaded. Task ID: {serialize}", flush=True)
    else:
        parser.error("Need either --video to upload or --serialize to resume")

    while True:
        status = check_status(api_key, serialize)
        label = STATUS_LABELS.get(status, f"Unknown ({status})")
        print(f"Status: {label}", flush=True)
        if status == 2:
            break
        if status in (1, 4):
            print("Processing did not complete successfully. Exiting.")
            sys.exit(1)
        time.sleep(args.poll_interval)

    print("Fetching download link (valid 60 min)...")
    model_url = get_download_url(api_key, serialize)
    print(f"Download link: {model_url}")

    print(f"Downloading to {args.out}...")
    download_file(model_url, args.out)
    extra = " and .obj mesh" if args.include_mesh else ""
    print(f"Done. Unzip {args.out} to find the .ply splat{extra}.")


if __name__ == "__main__":
    main()
