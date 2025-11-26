from urllib.parse import urlparse
import pandas as pd
import numpy as np

df = pd.read_csv("data.csv")

data = {
    "54b1535b-ba35-4907-8713-89aa5ea918e": "代理店エージェント",
    "38095b5d-ccc6-4bcb-813d-ca9e96bd4cfc": "テレアポ",
    "65cbb211-5078-44e8-90a7-8ffc9b8200c2": "高圧エージェント",
}

df["商材"] = df["profile_id"].map(data)
df["会社名"] = "パートナーリンク"
df["HP"] = df["contact_url"].apply(
    lambda x: f"{urlparse(x).scheme}://{urlparse(x).netloc}" if pd.notnull(x) else x
)
df["コンタクトURL"] = df["contact_url"]
df["送信時刻"] = pd.to_datetime(df["created_at"])
df["送信時刻"] = df["送信時刻"] + pd.Timedelta(hours=9)
df["結果"] = np.where(df["result"] == "success", "success", "fail")

df[["HP", "コンタクトURL", "結果", "送信時刻", "会社名", "商材"]].to_csv(
    "result.csv", index=False, encoding="utf-8-sig"
)
