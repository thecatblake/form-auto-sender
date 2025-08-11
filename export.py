import csv

# Input and output file paths
csv_file = "url_samples.csv"   # your CSV file name
txt_file = "urls.txt"    # output TXT file name

# Read the CSV and extract the 'URL' column
urls = []
with open(csv_file, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    if 'URL' not in reader.fieldnames:
        raise ValueError("The CSV file does not have a 'URL' column.")
    for row in reader:
        url = row['URL'].strip()
        if url:
            urls.append(url)

# Write URLs to text file
with open(txt_file, 'w', encoding='utf-8') as f:
    for url in urls:
        f.write(url + '\n')

print(f"Extracted {len(urls)} URLs to {txt_file}")