import requests

API_URL = "http://35.78.205.169:3000/profile"

profiles = [
    {
        "name": "PL_high",
        "body": open("./pl_high.json", "r", encoding="utf-8-sig").read(),
    },
    {
        "name": "PL_teleapo",
        "body": open("./pl_teleapo.json", "r", encoding="utf-8-sig").read(),
    },
    {
        "name": "PL_dairi_agent",
        "body": open("./pl_dairi_agent.json", "r", encoding="utf-8-sig").read(),
    },
]

for profile in profiles:
    res = requests.post(API_URL, json=profile)
    print(f"{profile["name"]} → {res.status_code}")
