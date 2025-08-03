import { z } from 'zod';

export const apiSuccessResponse = <T extends z.ZodTypeAny>(
    dataSchema: T
): z.ZodObject<{
    success: z.ZodLiteral<true>;
    data: T;
}> => {
    return z.object({
        success: z.literal(true),
        data: dataSchema
    });
};

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
        apiSuccessResponse(dataSchema)
    ]);
};
