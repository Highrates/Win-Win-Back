import { ConfigService } from '@nestjs/config';
import { productQaPreModerationEnabled } from './product-qa.constants';

/** Глобальный pre-mod (env `PRODUCT_QA_PREMODERATION=1`). */
export function isProductQaPreModerationEnabled(config: ConfigService): boolean {
  return productQaPreModerationEnabled(config.get<string>('PRODUCT_QA_PREMODERATION'));
}
