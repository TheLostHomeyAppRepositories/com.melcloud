import { Device } from 'homey' // eslint-disable-line import/no-extraneous-dependencies
import { DateTime } from 'luxon'
import type MELCloudApp from '../app'
import WithAPIAndLogging from '../mixin'
import type {
  Capability,
  CapabilityValue,
  ExtendedCapability,
  ExtendedSetCapability,
  GetDeviceData,
  ListCapabilityMapping,
  ListDevice,
  ListDeviceAny,
  ListDeviceData,
  MELCloudDriver,
  NonReportCapability,
  PostData,
  ReportCapability,
  ReportCapabilityMapping,
  ReportData,
  ReportPostData,
  SetCapability,
  SetCapabilityMapping,
  SetDeviceData,
  Settings,
  SettingValue,
  SyncFromMode,
  SyncMode,
  UpdateDeviceData,
} from '../types'

export default abstract class BaseMELCloudDevice extends WithAPIAndLogging(
  Device
) {
  app!: MELCloudApp

  declare driver: MELCloudDriver

  id!: number

  buildingid!: number

  diff!: Map<SetCapability<MELCloudDriver>, CapabilityValue>

  syncTimeout!: NodeJS.Timeout

  reportTimeout: {
    false: NodeJS.Timeout | null
    true: NodeJS.Timeout | null
  } = { true: null, false: null }

  reportInterval: { false?: NodeJS.Timeout; true?: NodeJS.Timeout } = {}

  reportPlanParameters!: {
    duration: object
    interval: object
    minus: object
    values: object
  }

  async onInit<T extends MELCloudDriver>(): Promise<void> {
    this.app = this.homey.app as MELCloudApp

    const { id, buildingid } = this.getData()
    this.id = id
    this.buildingid = buildingid
    this.diff = new Map<SetCapability<T>, CapabilityValue>()

    await this.handleCapabilities()
    this.registerCapabilityListeners()
    this.app.applySyncFromDevices()

    await this.runEnergyReports()
  }

  async setDeviceData<T extends MELCloudDriver>(
    updateData: SetDeviceData<T>
  ): Promise<GetDeviceData<T> | null> {
    try {
      const postData: PostData<T> = {
        DeviceID: this.id,
        HasPendingCommand: true,
        ...updateData,
      }
      const { data } = await this.api.post<GetDeviceData<T>>(
        `/Device/Set${this.driver.heatPumpType}`,
        postData
      )
      return data
    } catch (error: unknown) {
      return null
    }
  }

  async reportEnergyCost<T extends MELCloudDriver>(
    fromDate: DateTime,
    toDate: DateTime
  ): Promise<ReportData<T> | null> {
    try {
      const postData: ReportPostData = {
        DeviceID: this.id,
        FromDate: fromDate.toISODate() ?? '',
        ToDate: toDate.toISODate() ?? '',
        UseCurrency: false,
      }
      const { data } = await this.api.post<ReportData<T>>(
        '/EnergyCost/Report',
        postData
      )
      return data
    } catch (error: unknown) {
      return null
    }
  }

  isDiff(): boolean {
    return this.diff.size > 0
  }

  getDashboardCapabilities(settings: Settings = this.getSettings()): string[] {
    return Object.keys(settings).filter(
      (setting: string) => settings[setting] === true
    )
  }

  getReportCapabilities<T extends MELCloudDriver>(
    total = false
  ): Record<ReportCapability<T>, ReportCapabilityMapping<T>> {
    return Object.fromEntries(
      Object.entries(this.driver.reportCapabilityMapping)
        .filter(
          ([capability]: [string, ReportCapabilityMapping<T>]) =>
            this.hasCapability(capability) &&
            capability.includes('total') === total
        )
        .map(([capability, tags]: [string, ReportCapabilityMapping<T>]) => [
          capability as ReportCapability<T>,
          tags,
        ])
    ) as Record<ReportCapability<T>, ReportCapabilityMapping<T>>
  }

  async handleCapabilities(): Promise<void> {
    const requiredCapabilities: string[] = [
      ...this.driver.getRequiredCapabilities(this.getStore()),
      ...this.getDashboardCapabilities(),
    ]
    await requiredCapabilities.reduce<Promise<void>>(
      async (acc, capability: string) => {
        await acc
        return this.addCapability(capability)
      },
      Promise.resolve()
    )
    await this.getCapabilities()
      .filter(
        (capability: string) => !requiredCapabilities.includes(capability)
      )
      .reduce<Promise<void>>(async (acc, capability: string) => {
        await acc
        await this.removeCapability(capability)
      }, Promise.resolve())
  }

  registerCapabilityListeners<T extends MELCloudDriver>(): void {
    ;[
      ...Object.keys(this.driver.setCapabilityMapping),
      'thermostat_mode',
    ].forEach((capability: string): void => {
      this.registerCapabilityListener(
        capability,
        async (value: CapabilityValue): Promise<void> => {
          await this.onCapability(capability as ExtendedSetCapability<T>, value)
        }
      )
    })
  }

  async onCapability<T extends MELCloudDriver>(
    capability: ExtendedSetCapability<T>,
    value: CapabilityValue
  ): Promise<void> {
    this.clearSync()
    if (capability === 'onoff') {
      await this.setAlwaysOnWarning()
    }
    await this.specificOnCapability(capability, value)
    this.applySyncToDevice()
  }

  abstract specificOnCapability(
    capability: ExtendedSetCapability<MELCloudDriver>,
    value: CapabilityValue
  ): Promise<void>

  clearSync(): void {
    this.app.clearListDevicesRefresh()
    this.homey.clearTimeout(this.syncTimeout)
    this.log('Sync with device has been paused')
  }

  async setAlwaysOnWarning(): Promise<void> {
    if (this.getSetting('always_on') === true) {
      await this.setWarning(this.homey.__('warnings.always_on'))
      await this.setWarning(null)
    }
  }

  async setDisplayErrorWarning(): Promise<void> {
    await this.setWarning(this.homey.__('warnings.display_error'))
    await this.setWarning(null)
  }

  applySyncToDevice(): void {
    this.syncTimeout = this.setTimeout(
      'sync with device',
      async (): Promise<void> => {
        await this.syncToDevice()
      },
      { seconds: 1 },
      'seconds'
    )
  }

  async syncToDevice<T extends MELCloudDriver>(): Promise<void> {
    const updateData: SetDeviceData<T> = this.buildUpdateData()
    const data: GetDeviceData<T> | null = await this.setDeviceData(updateData)
    await this.endSync(data, 'syncTo')
  }

  buildUpdateData<T extends MELCloudDriver>(): SetDeviceData<T> {
    return Object.entries(this.driver.setCapabilityMapping).reduce<
      UpdateDeviceData<T>
    >(
      (
        acc,
        [capability, { tag, effectiveFlag }]: [string, SetCapabilityMapping<T>]
      ) => {
        if (this.hasCapability(capability)) {
          acc[tag] = this.convertToDevice(
            capability as SetCapability<T>,
            this.diff.get(capability as SetCapability<T>)
          ) as SetDeviceData<T>[Exclude<
            keyof SetDeviceData<T>,
            'EffectiveFlags'
          >]
          if (this.diff.has(capability as SetCapability<T>)) {
            this.diff.delete(capability as SetCapability<T>)
            acc.EffectiveFlags = Number(
              BigInt(acc.EffectiveFlags) | effectiveFlag
            )
          }
        }
        return acc
      },
      { EffectiveFlags: 0 }
    ) as SetDeviceData<T>
  }

  convertToDevice(
    capability: SetCapability<MELCloudDriver>,
    value: CapabilityValue = this.getCapabilityValue(capability)
  ): boolean | number {
    if (capability === 'onoff') {
      return this.getSetting('always_on') === true ? true : (value as boolean)
    }
    return value as boolean | number
  }

  async endSync<T extends MELCloudDriver>(
    data: Partial<ListDeviceData<T>> | null,
    syncMode?: SyncMode
  ): Promise<void> {
    await this.updateCapabilities(data, syncMode)
    await this.updateThermostatMode()
    if (syncMode === 'syncTo' && !this.isDiff()) {
      this.app.applySyncFromDevices(undefined, 'syncFrom')
    }
  }

  async updateCapabilities<T extends MELCloudDriver>(
    data: Partial<ListDeviceData<T>> | null,
    syncMode?: SyncMode
  ): Promise<void> {
    if (data?.EffectiveFlags === undefined) {
      return
    }
    const effectiveFlags = BigInt(data.EffectiveFlags)
    const combinedCapabilities = {
      ...this.driver.setCapabilityMapping,
      ...this.driver.getCapabilityMapping,
    }

    const capabilitiesToProcess = () => {
      switch (syncMode) {
        case 'syncTo':
          return combinedCapabilities
        case 'syncFrom':
          return this.driver.listCapabilityMapping
        default:
          return {
            ...combinedCapabilities,
            ...this.driver.listCapabilityMapping,
          }
      }
    }

    const capabilities: [NonReportCapability<T>, ListCapabilityMapping<T>][] =
      Object.entries(capabilitiesToProcess()) as [
        NonReportCapability<T>,
        ListCapabilityMapping<T>
      ][]
    const keysToProcessLast: string[] = [
      'operation_mode_state.zone1',
      'operation_mode_state.zone2',
    ]
    const [regularCapabilities, lastCapabilities]: [
      NonReportCapability<T>,
      ListCapabilityMapping<T>
    ][][] = capabilities.reduce<
      [NonReportCapability<T>, ListCapabilityMapping<T>][][]
    >(
      (
        acc,
        [capability, capabilityData]: [
          NonReportCapability<T>,
          ListCapabilityMapping<T>
        ]
      ) => {
        if (keysToProcessLast.includes(capability)) {
          acc[1].push([capability, capabilityData])
        } else {
          acc[0].push([capability, capabilityData])
        }
        return acc
      },
      [[], []]
    )

    const shouldProcess = (
      capability: NonReportCapability<T>,
      effectiveFlag?: bigint
    ): boolean => {
      switch (syncMode) {
        case 'syncTo':
          return (
            effectiveFlag === undefined ||
            Boolean(effectiveFlag & effectiveFlags)
          )
        case 'syncFrom':
          return !(capability in combinedCapabilities)
        default:
          return true
      }
    }

    const processCapability = async ([capability, { tag, effectiveFlag }]: [
      NonReportCapability<T>,
      ListCapabilityMapping<T>
    ]): Promise<void> => {
      if (shouldProcess(capability, effectiveFlag)) {
        await this.convertFromDevice(capability, data[tag] as boolean | number)
      }
    }

    const processCapabilities = async (
      capabilitiesArray: [NonReportCapability<T>, ListCapabilityMapping<T>][]
    ): Promise<void> => {
      await Promise.all(capabilitiesArray.map(processCapability))
    }

    await processCapabilities(regularCapabilities)
    await processCapabilities(lastCapabilities)
  }

  abstract convertFromDevice(
    capability: Capability<MELCloudDriver>,
    value: boolean | number
  ): Promise<void>

  abstract updateThermostatMode(): Promise<void>

  async syncDeviceFromList<T extends MELCloudDriver>(
    syncMode?: SyncFromMode
  ): Promise<void> {
    const deviceFromList: ListDevice<T> | undefined = this.getDeviceFromList()
    const data: ListDeviceData<T> | null = deviceFromList?.Device ?? null
    this.log('Syncing from device list:', data)
    await this.updateStore(data)
    await this.endSync(data, syncMode)
  }

  getDeviceFromList<T extends MELCloudDriver>(): ListDevice<T> | undefined {
    return this.app.deviceList.find(
      (device: ListDeviceAny) => device.DeviceID === this.id
    ) as ListDevice<T> | undefined
  }

  abstract updateStore<T extends MELCloudDriver>(
    data: ListDeviceData<T> | null
  ): Promise<void>

  async runEnergyReports(): Promise<void> {
    await this.runEnergyReport()
    await this.runEnergyReport(true)
  }

  async runEnergyReport<T extends MELCloudDriver>(
    total = false
  ): Promise<void> {
    const reportCapabilities: Record<
      ReportCapability<T>,
      ReportCapabilityMapping<T>
    > = this.getReportCapabilities(total)
    if (Object.keys(reportCapabilities).length === 0) {
      return
    }
    const toDate: DateTime = DateTime.now().minus(
      this.reportPlanParameters.minus
    )
    const fromDate: DateTime = total ? DateTime.local(1970) : toDate
    const data: ReportData<T> | null = await this.reportEnergyCost(
      fromDate,
      toDate
    )
    await this.updateReportCapabilities(data, toDate, reportCapabilities)
    this.planEnergyReport(total)
  }

  async updateReportCapabilities<T extends MELCloudDriver>(
    data: ReportData<T> | null,
    toDate: DateTime,
    reportCapabilities: Record<ReportCapability<T>, ReportCapabilityMapping<T>>
  ): Promise<void> {
    if (data === null) {
      return
    }
    const deviceCount: number =
      'UsageDisclaimerPercentages' in data
        ? data.UsageDisclaimerPercentages.split(',').length
        : 1

    const updateReportCapability = async ([capability, tags]: [
      ReportCapability<T>,
      ReportCapabilityMapping<T>
    ]): Promise<void> => {
      const reportValue = (): number => {
        if (capability.includes('cop')) {
          return (
            (data[tags[0]] as number) /
            (tags.length > 1 ? (data[tags[1]] as number) : 1)
          )
        }
        return (
          tags.reduce<number>(
            (acc, tag: keyof ReportData<T>) =>
              acc +
              (capability.includes('measure_power')
                ? (data[tag] as number[])[toDate.hour] * 1000
                : (data[tag] as number)),
            0
          ) / deviceCount
        )
      }
      await this.setCapabilityValue(capability, reportValue())
    }

    await Promise.all(
      (
        Object.entries(reportCapabilities) as [
          ReportCapability<T>,
          ReportCapabilityMapping<T>
        ][]
      ).map(updateReportCapability)
    )
  }

  planEnergyReport(total = false): void {
    const totalString: 'true' | 'false' = total ? 'true' : 'false'
    if (this.reportTimeout[totalString] !== null) {
      return
    }
    const type = `${total ? 'total' : 'regular'} energy report`
    const { interval, duration, values } = total
      ? {
          interval: { days: 1 },
          duration: { days: 1 },
          values: { hour: 1, minute: 5, second: 0, millisecond: 0 },
        }
      : this.reportPlanParameters
    this.reportTimeout[totalString] = this.setTimeout(
      type,
      async (): Promise<void> => {
        await this.runEnergyReport(total)
        this.reportInterval[totalString] = this.setInterval(
          type,
          async (): Promise<void> => {
            await this.runEnergyReport(total)
          },
          interval,
          'days',
          'hours'
        )
      },
      DateTime.now().plus(duration).set(values).diffNow(),
      'hours',
      'minutes'
    )
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    changedKeys: string[]
    newSettings: Settings
  }): Promise<void> {
    if (
      changedKeys.some((setting: string) => !['always_on'].includes(setting))
    ) {
      await this.handleDashboardCapabilities(newSettings, changedKeys)
      await this.setWarning(this.homey.__('warnings.dashboard'))
      await this.setWarning(null)
    }

    if (changedKeys.includes('always_on') && newSettings.always_on === true) {
      await this.onCapability('onoff', true)
    } else if (
      changedKeys.some(
        (setting: string) =>
          setting !== 'always_on' &&
          !(setting in this.driver.reportCapabilityMapping)
      )
    ) {
      this.app.applySyncFromDevices()
    }

    const changedEnergyKeys: string[] = changedKeys.filter(
      (setting: string) => setting in this.driver.reportCapabilityMapping
    )
    if (changedEnergyKeys.length === 0) {
      return
    }
    await Promise.all(
      [false, true].map(async (total: boolean): Promise<void> => {
        const changed: string[] = changedEnergyKeys.filter(
          (setting: string) => setting.includes('total') === total
        )
        if (changed.length === 0) {
          return
        }
        if (changed.some((setting: string) => newSettings[setting] === true)) {
          await this.runEnergyReport(total)
        } else if (
          Object.entries(newSettings).every(
            ([setting, value]: [string, SettingValue]) =>
              !(setting in this.driver.reportCapabilityMapping) ||
              value === false
          )
        ) {
          this.clearEnergyReportPlan(total)
        }
      })
    )
  }

  async handleDashboardCapabilities(
    newSettings: Settings,
    changedCapabilities: string[]
  ): Promise<void> {
    await changedCapabilities.reduce<Promise<void>>(
      async (acc, capability: string) => {
        await acc
        if (newSettings[capability] === true) {
          await this.addCapability(capability)
        } else {
          await this.removeCapability(capability)
        }
      },
      Promise.resolve()
    )
  }

  clearEnergyReportPlans(): void {
    this.clearEnergyReportPlan()
    this.clearEnergyReportPlan(true)
  }

  clearEnergyReportPlan(total = false): void {
    const totalString: 'true' | 'false' = total ? 'true' : 'false'
    this.homey.clearTimeout(this.reportTimeout[totalString])
    this.homey.clearInterval(this.reportInterval[totalString])
    this.reportTimeout[totalString] = null
    this.log(total ? 'Total' : 'Regular', 'energy report has been stopped')
  }

  onDeleted(): void {
    this.clearSync()
    this.clearEnergyReportPlans()
  }

  async addCapability(capability: string): Promise<void> {
    if (!this.hasCapability(capability)) {
      try {
        await super.addCapability(capability)
        this.log('Adding capability', capability)
      } catch (error: unknown) {
        this.error(error instanceof Error ? error.message : error)
      }
    }
  }

  async removeCapability(capability: string): Promise<void> {
    if (this.hasCapability(capability)) {
      try {
        await super.removeCapability(capability)
        this.log('Removing capability', capability)
      } catch (error: unknown) {
        this.error(error instanceof Error ? error.message : error)
      }
    }
  }

  async setCapabilityValue<T extends MELCloudDriver>(
    capability: ExtendedCapability<T>,
    value: CapabilityValue
  ): Promise<void> {
    if (
      this.hasCapability(capability) &&
      value !== this.getCapabilityValue(capability)
    ) {
      try {
        await super.setCapabilityValue(capability, value)
        this.log('Capability', capability, 'is', value)
      } catch (error: unknown) {
        this.error(error instanceof Error ? error.message : error)
      }
    }
  }
}