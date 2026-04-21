import { z } from 'zod';

/**
 * Client-side mirror of the backend ConnectStoreInputSchema. Keeps the
 * form instant-validating with IDENTICAL error codes so the frontend
 * i18n namespace (stores.connect.errors.*) serves both client-side zod
 * errors and backend VALIDATION_ERROR issues with zero branching.
 */
export const ConnectStoreFormSchema = z.object({
  name: z.string().trim().min(2, 'INVALID_NAME_TOO_SHORT').max(80, 'INVALID_NAME_TOO_LONG'),
  environment: z.enum(['PRODUCTION', 'SANDBOX']),
  credentials: z.object({
    platform: z.literal('TRENDYOL'),
    supplierId: z
      .string()
      .regex(/^[A-Za-z0-9]+$/, 'INVALID_SUPPLIER_ID_FORMAT')
      .min(1, 'INVALID_SUPPLIER_ID_FORMAT')
      .max(20, 'INVALID_SUPPLIER_ID_FORMAT'),
    // Trendyol dokümantasyonu spesifik bir API key / secret formatı
    // tanımlamıyor. Buradaki validation sadece bariz kopyala-yapıştır
    // hatalarını (çok kısa, çok uzun, içinde boşluk/newline) yakalar;
    // gerçek doğrulama backend adapter probe'u ile olur — yanlış
    // credentials → MARKETPLACE_AUTH_FAILED (422).
    apiKey: z
      .string()
      .trim()
      .min(8, 'INVALID_API_KEY_FORMAT')
      .max(128, 'INVALID_API_KEY_FORMAT')
      .regex(/^\S+$/, 'INVALID_API_KEY_FORMAT'),
    apiSecret: z
      .string()
      .trim()
      .min(8, 'INVALID_API_KEY_FORMAT')
      .max(128, 'INVALID_API_KEY_FORMAT')
      .regex(/^\S+$/, 'INVALID_API_KEY_FORMAT'),
  }),
});

export type ConnectStoreFormValues = z.infer<typeof ConnectStoreFormSchema>;
