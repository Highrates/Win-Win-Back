/** ~10 «тяжёлых» submit/create в минуту (заявка на подбор, отправка заказа на согласование). */
export const USER_HEAVY_CREATE_THROTTLE = { default: { ttl: 60_000, limit: 10 } } as const;
