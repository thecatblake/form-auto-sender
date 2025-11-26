import pandas as pd

data = [
    {"id": "e2f936bb-f38f-436f-af21-d75bdf76bc4e", "file": "urls.txt"}
]

dfs = []

for i in range(len(data)):
    df = pd.read_csv(data[i]["file"], names=["url"])
    print(df.head())
    df["id"] = data[i]["id"]
    dfs.append(df)

result = pd.concat(dfs, ignore_index=True)
result = result.sample(frac=1).reset_index(drop=True)

result.to_csv("mix.csv", index=False)
