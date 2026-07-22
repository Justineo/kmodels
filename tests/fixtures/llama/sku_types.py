class CoreModelId(Enum):
    llama2_7b = "Llama-2-7b"
    llama3_1_8b_instruct = "Llama3.1-8B-Instruct"
    llama3_2_1b_instruct = "Llama3.2-1B-Instruct"
    llama3_3_70b_instruct = "Llama3.3-70B-Instruct"
    llama4_maverick_17b_128e = "Llama-4-Maverick-17B-128E"
    llama4_maverick_17b_128e_instruct = "Llama-4-Maverick-17B-128E-Instruct"
    llama_guard_3_11b_vision = "Llama-Guard-3-11B-Vision"


def is_multimodal(model_id):
    return False
