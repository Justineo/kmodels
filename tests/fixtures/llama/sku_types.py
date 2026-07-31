class ModelFamily(Enum):
    llama2 = "llama2"
    llama3_1 = "llama3_1"
    llama3_2 = "llama3_2"
    llama3_3 = "llama3_3"
    llama4 = "llama4"
    safety = "safety"


class CoreModelId(Enum):
    llama2_7b = "Llama-2-7b"
    llama3_1_8b_instruct = "Llama3.1-8B-Instruct"
    llama3_2_1b_instruct = "Llama3.2-1B-Instruct"
    llama3_3_70b_instruct = "Llama3.3-70B-Instruct"
    llama4_maverick_17b_128e = "Llama-4-Maverick-17B-128E"
    llama4_maverick_17b_128e_instruct = "Llama-4-Maverick-17B-128E-Instruct"
    llama_guard_2_8b = "Llama-Guard-2-8B"
    llama_guard_3_8b = "Llama-Guard-3-8B"
    llama_guard_3_11b_vision = "Llama-Guard-3-11B-Vision"
    llama_guard_4_12b = "Llama-Guard-4-12B"


def is_multimodal(model_id):
    return False


def model_family(model_id):
    if model_id in [
        CoreModelId.llama2_7b,
    ]:
        return ModelFamily.llama2
    elif model_id in [
        CoreModelId.llama3_1_8b_instruct,
    ]:
        return ModelFamily.llama3_1
    elif model_id in [
        CoreModelId.llama3_2_1b_instruct,
    ]:
        return ModelFamily.llama3_2
    elif model_id in [
        CoreModelId.llama3_3_70b_instruct,
    ]:
        return ModelFamily.llama3_3
    elif model_id in [
        CoreModelId.llama4_maverick_17b_128e,
        CoreModelId.llama4_maverick_17b_128e_instruct,
    ]:
        return ModelFamily.llama4
    elif model_id in [
        CoreModelId.llama_guard_2_8b,
        CoreModelId.llama_guard_3_8b,
        CoreModelId.llama_guard_3_11b_vision,
        CoreModelId.llama_guard_4_12b,
    ]:
        return ModelFamily.safety


class Model(BaseModel):
    @property
    def max_seq_length(self) -> int:
        if self.model_family == ModelFamily.llama2:
            return 4096
        elif self.core_model_id == CoreModelId.llama_guard_2_8b:
            return 4096
        elif self.model_family in [ModelFamily.llama3_1, ModelFamily.llama3_3]:
            return 131072
        elif self.model_family == ModelFamily.llama3_2:
            if self.quantization_format == CheckpointQuantizationFormat.int4:
                return 8192
            return 131072
        elif self.model_family == ModelFamily.llama4:
            if self.core_model_id in {
                CoreModelId.llama4_maverick_17b_128e,
            }:
                return 262144
            if self.core_model_id == CoreModelId.llama4_maverick_17b_128e_instruct:
                return 1048576
            raise AssertionError
        elif self.core_model_id in [
            CoreModelId.llama_guard_3_8b,
            CoreModelId.llama_guard_3_11b_vision,
        ]:
            return 131072
        elif self.core_model_id == CoreModelId.llama_guard_4_12b:
            return 8192
        else:
            raise ValueError
