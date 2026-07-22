MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8"

response = client.chat.completions.create(model=MODEL, tools=[])
