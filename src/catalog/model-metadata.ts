import { z } from "zod";

const text = z.string().min(1).max(2048);

// Publisher labels and ranges remain labels; they are not exact parameter/token counts.
export const modelCardSchema = z.strictObject({
  publisher: text.optional(),
  license: text.optional(),
  size: text.optional(),
  context_window: text.optional(),
  languages: z.array(text).max(512).optional(),
  upstream_id: text.optional(),
  access: text.optional(),
  framework: text.optional(),
});

export const deploymentProfileSchema = z.strictObject({
  name: text,
  configurations: z.array(text).max(100),
  instance_types: z.array(text).max(512),
  default_instance_type: text.optional(),
  framework: text.optional(),
  framework_version: text.optional(),
  context_settings: z
    .array(
      z.strictObject({
        name: text,
        value: z.union([text, z.number().finite()]),
        instance_type: text.optional(),
      }),
    )
    .max(2048),
});

export const deploymentSpecSchema = z.strictObject({
  package_version: text
    .refine((value) => !/\barn:/i.test(value), "Package version must not be a resource ARN")
    .optional(),
  region: text,
  profiles: z.array(deploymentProfileSchema).max(100),
});
