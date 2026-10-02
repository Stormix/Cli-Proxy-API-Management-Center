import { bindQuotaClasses } from '../types';
import bodyStyles from './QuotaBody.module.scss';

/** 额度页全页外衣：QuotaBody 模块绑定成类型化契约（缺键在模块初始化即抛）。 */
export const quotaPageClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');
