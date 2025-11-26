import pandas as pd

data = [
    {"id": "54b1535b-ba35-4907-8713-89aa5ea918e", "file": "pl_dairi_agent.txt"},
    {"id": "38095b5d-ccc6-4bcb-813d-ca9e96bd4cfc", "file": "pl_teleapo.txt"},
    {"id": "65cbb211-5078-44e8-90a7-8ffc9b8200c2", "file": "pl_high.txt"},
]

dfs = []

for i in range(len(data)):
    df = pd.read_csv(data[i]["file"], names=["URL"])
    print(df.head())
    df["id"] = data[i]["id"]
    dfs.append(df)

result = pd.concat(dfs, ignore_index=True)
result = result.sample(frac=1).reset_index(drop=True)

result.to_csv("mix.csv", index=False)
