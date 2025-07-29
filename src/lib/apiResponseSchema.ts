import { z } from 'zod';

export const apiResponse = <T extends z.ZodTypeAny>(
    dataSchema: T
): z.ZodUnion<
    [
        z.ZodObject<{ success: z.ZodLiteral<false>; message: z.ZodString }>,
        z.ZodObject<{ success: z.ZodLiteral<true>; data: T }>
    ]
> => {
    return z.union([
        z.object({
            success: z.literal(false),
            message: z.string()
        }),
        z.object({
            success: z.literal(true),
            data: dataSchema
        })
    ]);
};
