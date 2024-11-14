import { BaseEnergyReport } from '../../bases/report.mts'

export abstract class BaseEnergyReportAta extends BaseEnergyReport<'Ata'> {
  protected readonly minus = { hours: 1 }
}
