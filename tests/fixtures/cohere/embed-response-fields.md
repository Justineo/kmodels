POST https://api.cohere.com/v2/embed

## Response

### 200

OK

- `id` (string, required)
- `embeddings` (object, required) — An object with different embedding types. The length of each embedding type array will be the same as the length of the original `texts` array.
  - `float` (list of list of double, optional) — An array of float embeddings.
  - `int8` (list of list of integer, optional) — An array of signed int8 embeddings. Each value is between -128 and 127.
  - `uint8` (list of list of integer, optional) — An array of unsigned int8 embeddings. Each value is between 0 and 255.
  - `binary` (list of list of integer, optional) — An array of packed signed binary embeddings. The length of each binary embedding is 1/8 the length of the float embeddings of the provided model. Each value is between -128 and 127.
  - `ubinary` (list of list of integer, optional) — An array of packed unsigned binary embeddings. The length of each binary embedding is 1/8 the length of the float embeddings of the provided model. Each value is between 0 and 255.
  - `base64` (list of string, optional) — An array of base64 embeddings. Each string is the result of appending the float embedding bytes together and base64 encoding that.
- `texts` (list of string, optional) — The text entries for which embeddings were returned.
- `images` (list of object, optional) — The image entries for which embeddings were returned.
  - `width` (long, required) — Width of the image in pixels
  - `height` (long, required) — Height of the image in pixels
  - `format` (string, required) — Format of the image
  - `bit_depth` (long, required) — Bit depth of the image
- `meta` (object, optional)
  - `api_version` (object, optional)
    - `version` (string, required)
    - `is_deprecated` (boolean, optional)
    - `is_experimental` (boolean, optional)
  - `billed_units` (object, optional)
    - `images` (double, optional) — The number of billed images.
    - `input_tokens` (double, optional) — The number of billed input tokens.
    - `image_tokens` (double, optional) — The number of billed image tokens.
    - `output_tokens` (double, optional) — The number of billed output tokens.
    - `search_units` (double, optional) — The number of billed search units.
    - `classifications` (double, optional) — The number of billed classifications units.
    - `pages` (double, optional) — The number of billed pages parsed.
  - `tokens` (object, optional)
    - `input_tokens` (double, optional) — The number of tokens used as input to the model.
    - `output_tokens` (double, optional) — The number of tokens produced by the model.
  - `cached_tokens` (double, optional) — The number of prompt tokens that hit the inference cache.
  - `warnings` (list of string, optional)
