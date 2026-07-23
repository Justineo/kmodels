response = client.chat.completions.create(
    model="Llama-4-Maverick-17B-128E-Instruct-FP8",
    response_format={"type": "json_schema"},
)
