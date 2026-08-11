# Pricing

Endpoint compute is billed per minute while successfully deployed endpoints are initializing or running.

| Provider | Instance Type | Instance Size | Hourly rate | vCPUs | Memory                      |
| -------- | ------------- | ------------- | ----------- | ----- | --------------------------- |
| aws      | intel-spr     | x1            | $0.033      | 1     | 2 GB                        |
| aws      | intel-spr     | x2            | $0.067      | 2     | 4 GB                        |
| _aws_    | _intel-icl_   | _x1_          | _$0.032_    | _1_   | _Deprecated from July 2025_ |

| Provider | Instance Type | Instance Size | Hourly rate | GPUs | Memory |
| -------- | ------------- | ------------- | ----------- | ---- | ------ |
| aws      | nvidia-t4     | x1            | $0.5        | 1    | 14 GB  |

The monthly example still shows `$0.064/hr` for intel-spr x2.
