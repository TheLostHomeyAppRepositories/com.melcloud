import { DateTime, Duration, type DurationLikeObject } from 'luxon'
import { Device } from 'homey'
import type MELCloudApp from '../app'
import type MELCloudDeviceAta from '../drivers/melcloud/device'
import type MELCloudDeviceAtw from '../drivers/melcloud_atw/device'
import {
  type NonReportCapability,
  type Capability,
  type CapabilityValue,
  type Data,
  type ExtendedCapability,
  type ExtendedSetCapability,
  type GetCapability,
  type GetCapabilityMapping,
  type ListCapability,
  type ListCapabilityMapping,
  type ReportCapabilityMapping,
  type ListDevice,
  type ListDeviceData,
  type MELCloudDevice,
  type MELCloudDriver,
  type ReportCapability,
  type ReportData,
  type SetCapabilities,
  type SetCapability,
  type SetCapabilityMapping,
  type Settings,
  type SyncFromMode,
  type SyncMode,
  type ThermostatMode,
  type UpdateData
} from '../types'

export default class MELCloudDeviceMixin extends Device {
  app!: MELCloudApp
  declare driver: MELCloudDriver
  operationModeCapability!:
    | SetCapability<MELCloudDeviceAta>
    | SetCapability<MELCloudDeviceAtw>

  operationModeToThermostatMode!: Record<string, ThermostatMode>
  requiredCapabilities!: string[]

  setCapabilityMapping!:
    | Record<
        SetCapability<MELCloudDeviceAta>,
        SetCapabilityMapping<MELCloudDeviceAta>
      >
    | Record<
        SetCapability<MELCloudDeviceAtw>,
        SetCapabilityMapping<MELCloudDeviceAtw>
      >

  getCapabilityMapping!:
    | Record<
        GetCapability<MELCloudDeviceAta>,
        GetCapabilityMapping<MELCloudDeviceAta>
      >
    | Record<
        GetCapability<MELCloudDeviceAtw>,
        GetCapabilityMapping<MELCloudDeviceAtw>
      >

  listCapabilityMapping!:
    | Record<
        ListCapability<MELCloudDeviceAta>,
        ListCapabilityMapping<MELCloudDeviceAta>
      >
    | Record<
        ListCapability<MELCloudDeviceAtw>,
        ListCapabilityMapping<MELCloudDeviceAtw>
      >

  reportCapabilityMapping!:
    | Record<
        ReportCapability<MELCloudDeviceAta>,
        ReportCapabilityMapping<MELCloudDeviceAta>
      >
    | Record<
        ReportCapability<MELCloudDeviceAtw>,
        ReportCapabilityMapping<MELCloudDeviceAtw>
      >

  id!: number
  driverId!: string
  driverUri!: string
  buildingid!: number
  diff!: SetCapabilities<MELCloudDeviceAta> | SetCapabilities<MELCloudDeviceAtw>

  syncTimeout!: NodeJS.Timeout
  reportTimeout!: { true: NodeJS.Timeout | null; false: NodeJS.Timeout | null }
  reportInterval!: { true?: NodeJS.Timeout; false?: NodeJS.Timeout }
  reportPlanParameters!: {
    minus: object
    interval: object
    duration: object
    values: object
  }

  async onInit(): Promise<void> {
    this.app = this.homey.app as MELCloudApp

    const { id, buildingid } = this.getData()
    this.id = id
    this.buildingid = buildingid
    this.diff = {}

    this.requiredCapabilities = [...this.requiredCapabilities, 'measure_power']
    await this.handleCapabilities()
    this.registerCapabilityListeners()
    this.app.applySyncFromDevices()

    this.reportTimeout = { true: null, false: null }
    this.reportInterval = {}
    await this.runEnergyReports()
  }

  isDiff(): boolean {
    return Object.keys(this.diff).length > 0
  }

  getDashboardCapabilities(settings: Settings = this.getSettings()): string[] {
    return Object.keys(settings).filter(
      (setting: string): boolean => settings[setting] === true
    )
  }

  getReportCapabilities<T extends MELCloudDevice>(
    total: boolean = false
  ): Record<ReportCapability<T>, ReportCapabilityMapping<T>> {
    return Object.entries(this.reportCapabilityMapping).reduce<any>(
      (
        reportCapabilities,
        [capability, tags]: [string, ReportCapabilityMapping<T>]
      ) => {
        if (
          this.hasCapability(capability) &&
          capability.includes('total') === total
        ) {
          reportCapabilities[capability] = tags
        }
        return reportCapabilities
      },
      {}
    )
  }

  async handleCapabilities(): Promise<void> {
    const requiredCapabilities: string[] = [
      ...this.requiredCapabilities,
      ...this.getDashboardCapabilities()
    ]
    await Promise.all(
      requiredCapabilities.map(async (capability: string): Promise<void> => {
        await this.addCapability(capability)
      })
    )
    await Promise.all(
      this.getCapabilities().map(async (capability: string): Promise<void> => {
        if (!requiredCapabilities.includes(capability)) {
          await this.removeCapability(capability)
        }
      })
    )
  }

  registerCapabilityListeners<T extends MELCloudDevice>(): void {
    ;[...Object.keys(this.setCapabilityMapping), 'thermostat_mode'].forEach(
      (capability: string): void => {
        this.registerCapabilityListener(
          capability,
          async (value: CapabilityValue): Promise<void> => {
            await this.onCapability(
              capability as ExtendedSetCapability<T>,
              value
            )
          }
        )
      }
    )
  }

  async onCapability<T extends MELCloudDevice>(
    capability: ExtendedSetCapability<T>,
    value: CapabilityValue
  ): Promise<void> {
    this.clearSync()
    switch (capability) {
      case 'onoff':
        this.diff.onoff = value as boolean
        await this.setAlwaysOnWarning()
        break
      case 'thermostat_mode':
        this.diff.onoff = String(value) !== 'off'
        await this.setAlwaysOnWarning()
        break
      case 'target_temperature':
        this.diff.target_temperature = value as number
    }
    await this.specificOnCapability(capability, value)
    this.applySyncToDevice()
  }

  async specificOnCapability(
    _capability:
      | ExtendedSetCapability<MELCloudDeviceAta>
      | ExtendedSetCapability<MELCloudDeviceAtw>,
    _value: CapabilityValue
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

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
        await this.syncToDevice(this.diff)
      },
      { seconds: 1 },
      'seconds'
    )
  }

  async syncToDevice<T extends MELCloudDevice>(
    diff: SetCapabilities<T>
  ): Promise<void> {
    this.diff = {}
    const updateData: UpdateData<T> = this.buildUpdateData(diff)
    const data: Data<T> | null = await this.app.setDeviceData(
      this as unknown as T,
      updateData
    )
    await this.endSync(data, 'syncTo')
  }

  buildUpdateData<T extends MELCloudDevice>(
    diff: SetCapabilities<T>
  ): UpdateData<T> {
    return Object.entries(this.setCapabilityMapping).reduce<any>(
      (updateData, [capability, { tag, effectiveFlag }]) => {
        if (!this.hasCapability(capability)) {
          return updateData
        }
        if (capability in diff) {
          updateData.EffectiveFlags = Number(
            BigInt(updateData.EffectiveFlags) | effectiveFlag
          )
        }
        updateData[tag] = this.convertToDevice(
          capability as SetCapability<T>,
          capability in diff
            ? (diff[capability as keyof SetCapabilities<T>] as CapabilityValue)
            : undefined
        )
        return updateData
      },
      { EffectiveFlags: 0 }
    )
  }

  convertToDevice(
    capability:
      | SetCapability<MELCloudDeviceAta>
      | SetCapability<MELCloudDeviceAtw>,
    value: CapabilityValue = this.getCapabilityValue(capability)
  ): boolean | number {
    if (capability === 'onoff') {
      return this.getSetting('always_on') === true ? true : (value as boolean)
    }
    return value as boolean | number
  }

  async endSync<T extends MELCloudDevice>(
    data: Partial<ListDeviceData<T>> | null,
    syncMode?: SyncMode
  ): Promise<void> {
    await this.updateCapabilities(data, syncMode)
    await this.updateThermostatMode()
    if (syncMode === 'syncTo' && !this.isDiff()) {
      this.app.applySyncFromDevices(undefined, 'syncFrom')
    }
  }

  async updateCapabilities<T extends MELCloudDevice>(
    data: Partial<ListDeviceData<T>> | null,
    syncMode?: SyncMode
  ): Promise<void> {
    if (data === null || data.EffectiveFlags === undefined) {
      return
    }
    const effectiveFlags: bigint = BigInt(data.EffectiveFlags)
    const combinedCapabilities: typeof this.getCapabilityMapping = {
      ...this.setCapabilityMapping,
      ...this.getCapabilityMapping
    }

    const capabilitiesToProcess = ():
      | typeof this.getCapabilityMapping
      | typeof this.listCapabilityMapping => {
      switch (syncMode) {
        case 'syncTo':
          return combinedCapabilities
        case 'syncFrom':
          return this.listCapabilityMapping
        default:
          return {
            ...combinedCapabilities,
            ...this.listCapabilityMapping
          }
      }
    }

    const capabilities: Array<
      [NonReportCapability<T>, ListCapabilityMapping<T>]
    > = Object.entries(capabilitiesToProcess()) as Array<
      [NonReportCapability<T>, ListCapabilityMapping<T>]
    >
    const keysToProcessLast: string[] = [
      'operation_mode_state.zone1',
      'operation_mode_state.zone2'
    ]
    const [regularCapabilities, lastCapabilities]: Array<
      Array<[NonReportCapability<T>, ListCapabilityMapping<T>]>
    > = capabilities.reduce<
      Array<Array<[NonReportCapability<T>, ListCapabilityMapping<T>]>>
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

    const processCapabilities = async (
      capabilitiesArray: Array<
        [NonReportCapability<T>, ListCapabilityMapping<T>]
      >
    ): Promise<void> => {
      await Promise.all(
        capabilitiesArray.map(
          async ([capability, { tag, effectiveFlag }]: [
            NonReportCapability<T>,
            ListCapabilityMapping<T>
          ]): Promise<void> => {
            await processCapability(capability, tag, effectiveFlag)
          }
        )
      )
    }
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
    const processCapability = async (
      capability: NonReportCapability<T>,
      tag: Exclude<keyof ListDeviceData<T>, 'EffectiveFlags'>,
      effectiveFlag?: bigint
    ): Promise<void> => {
      if (shouldProcess(capability, effectiveFlag)) {
        await this.convertFromDevice(capability, data[tag] as boolean | number)
      }
    }

    await processCapabilities(regularCapabilities)
    await processCapabilities(lastCapabilities)
  }

  async convertFromDevice(
    _capability: Capability<MELCloudDeviceAta> | Capability<MELCloudDeviceAtw>,
    _value: boolean | number
  ): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async updateThermostatMode(): Promise<void> {
    if (
      !this.hasCapability('thermostat_mode') ||
      this.operationModeCapability === undefined ||
      this.operationModeToThermostatMode === undefined
    ) {
      return
    }
    const isOn: boolean = this.getCapabilityValue('onoff')
    const operationMode: string | number = this.getCapabilityValue(
      this.operationModeCapability
    )
    await this.setCapabilityValue(
      'thermostat_mode',
      isOn ? this.operationModeToThermostatMode[operationMode] : 'off'
    )
  }

  async syncDeviceFromList<T extends MELCloudDevice>(
    syncMode?: SyncFromMode
  ): Promise<void> {
    const deviceFromList: ListDevice<T> | undefined =
      this.app.getDeviceFromList(this.id)
    const data: ListDeviceData<T> | null = deviceFromList?.Device ?? null
    this.log('Syncing from device list:', data)
    await this.updateStore(data)
    await this.endSync(data, syncMode)
  }

  async updateStore<T extends MELCloudDevice>(
    data: ListDeviceData<T> | null
  ): Promise<void> {
    if (data === null) {
      return
    }
    const { canCool, hasZone2 } = this.getStore()
    const { CanCool, HasZone2 } = data
    if (canCool !== CanCool || hasZone2 !== HasZone2) {
      await Promise.all([
        this.setStoreValue('canCool', CanCool),
        this.setStoreValue('hasZone2', HasZone2)
      ])
      await this.handleCapabilities()
    }
  }

  async runEnergyReports(): Promise<void> {
    await this.runEnergyReport()
    await this.runEnergyReport(true)
  }

  async runEnergyReport<T extends MELCloudDevice>(
    total: boolean = false
  ): Promise<void> {
    const reportCapabilities = this.getReportCapabilities(total)
    if (Object.keys(reportCapabilities).length === 0) {
      return
    }
    const toDate = DateTime.now().minus(this.reportPlanParameters.minus)
    const fromDate: DateTime = total ? DateTime.local(1970) : toDate
    const data: ReportData<T> | null = await this.app.reportEnergyCost(
      this as unknown as T,
      fromDate,
      toDate
    )
    if (data !== null) {
      const deviceCount: number =
        'UsageDisclaimerPercentages' in data
          ? data.UsageDisclaimerPercentages.split(',').length
          : 1
      await Promise.all(
        Object.entries(reportCapabilities).map(
          async ([capability, tags]: [
            string,
            ReportCapabilityMapping<T>
          ]): Promise<void> => {
            await this.updateReportCapability(
              data,
              capability as ReportCapability<T>,
              tags,
              deviceCount,
              toDate
            )
          }
        )
      )
    }
    this.planEnergyReport(total)
  }

  async updateReportCapability<T extends MELCloudDevice>(
    data: ReportData<T>,
    capability: ReportCapability<T>,
    tags: ReportCapabilityMapping<T>,
    deviceCount: number,
    toDate: DateTime
  ): Promise<void> {
    const reportValue = (): number => {
      if (capability.includes('cop')) {
        return (
          (data[tags[0]] as number) /
          (tags.length > 1 ? (data[tags[1]] as number) : 1)
        )
      }
      return (
        tags.reduce<number>(
          (sum, tag: keyof ReportData<T>) =>
            sum +
            (capability.includes('measure_power')
              ? (data[tag] as number[])[toDate.hour] * 1000
              : (data[tag] as number)),
          0
        ) / deviceCount
      )
    }
    await this.setCapabilityValue(capability, reportValue())
  }

  planEnergyReport(total: boolean = false): void {
    const totalString: 'true' | 'false' = total ? 'true' : 'false'
    if (this.reportTimeout[totalString] !== null) {
      return
    }
    const type: string = `${total ? 'total' : 'regular'} energy report`
    const { interval, duration, values } = total
      ? {
          interval: { days: 1 },
          duration: { days: 1 },
          values: { hour: 1, minute: 5, second: 0, millisecond: 0 }
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
    changedKeys
  }: {
    newSettings: Settings
    changedKeys: string[]
  }): Promise<void> {
    if (
      changedKeys.some(
        (setting: string): boolean => !['always_on'].includes(setting)
      )
    ) {
      await this.handleDashboardCapabilities(newSettings, changedKeys)
      await this.setWarning(this.homey.__('warnings.dashboard'))
      await this.setWarning(null)
    }

    if (changedKeys.includes('always_on') && newSettings.always_on === true) {
      await this.onCapability('onoff', true)
    } else if (
      changedKeys.some(
        (setting: string): boolean =>
          setting !== 'always_on' && !(setting in this.reportCapabilityMapping)
      )
    ) {
      this.app.applySyncFromDevices()
    }

    const changedEnergyKeys: string[] = changedKeys.filter(
      (setting: string): boolean => setting in this.reportCapabilityMapping
    )
    if (changedEnergyKeys.length === 0) {
      return
    }
    await Promise.all(
      [false, true].map(async (total: boolean): Promise<void> => {
        const changed: string[] = changedEnergyKeys.filter(
          (setting: string): boolean => setting.includes('total') === total
        )
        if (changed.length === 0) {
          return
        }
        if (
          changed.some(
            (setting: string): boolean => newSettings[setting] === true
          )
        ) {
          await this.runEnergyReport(total)
        } else if (
          Object.entries(newSettings).every(
            ([setting, value]: [string, any]): boolean =>
              !(setting in this.reportCapabilityMapping) || value === false
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
    await Promise.all(
      changedCapabilities.map(async (capability: string): Promise<void> => {
        if (newSettings[capability] === true) {
          await this.addCapability(capability)
          return
        }
        await this.removeCapability(capability)
      })
    )
  }

  clearEnergyReportPlans(): void {
    this.clearEnergyReportPlan()
    this.clearEnergyReportPlan(true)
  }

  clearEnergyReportPlan(total: boolean = false): void {
    const totalString: 'true' | 'false' = total ? 'true' : 'false'
    this.homey.clearTimeout(this.reportTimeout[totalString])
    this.homey.clearInterval(this.reportInterval[totalString])
    this.reportTimeout[totalString] = null
    this.log(total ? 'Total' : 'Regular', 'energy report has been stopped')
  }

  async onDeleted(): Promise<void> {
    this.clearSync()
    this.clearEnergyReportPlans()
  }

  async addCapability(capability: string): Promise<void> {
    if (!this.hasCapability(capability)) {
      await super
        .addCapability(capability)
        .then((): void => {
          this.log('Adding capability', capability)
        })
        .catch(this.error)
    }
  }

  async removeCapability(capability: string): Promise<void> {
    if (this.hasCapability(capability)) {
      await super
        .removeCapability(capability)
        .then((): void => {
          this.log('Removing capability', capability)
        })
        .catch(this.error)
    }
  }

  async setCapabilityValue<T extends MELCloudDevice>(
    capability: ExtendedCapability<T>,
    value: CapabilityValue
  ): Promise<void> {
    if (
      this.hasCapability(capability) &&
      value !== this.getCapabilityValue(capability)
    ) {
      await super
        .setCapabilityValue(capability, value)
        .then((): void => {
          this.log('Capability', capability, 'is', value)
        })
        .catch(this.error)
    }
  }

  setInterval(
    type: string,
    callback: () => Promise<void>,
    interval: number | object,
    ...units: Array<keyof DurationLikeObject>
  ): NodeJS.Timeout {
    const duration: Duration = Duration.fromDurationLike(interval)
    this.log(
      `${type.charAt(0).toUpperCase()}${type.slice(1)}`,
      'will run every',
      duration.shiftTo(...units).toHuman(),
      'starting',
      DateTime.now()
        .plus(duration)
        .toLocaleString(DateTime.DATETIME_HUGE_WITH_SECONDS)
    )
    return this.homey.setInterval(callback, Number(duration))
  }

  setTimeout(
    type: string,
    callback: () => Promise<void>,
    interval: number | object,
    ...units: Array<keyof DurationLikeObject>
  ): NodeJS.Timeout {
    const duration: Duration = Duration.fromDurationLike(interval)
    this.log(
      'Next',
      type,
      'will run in',
      duration.shiftTo(...units).toHuman(),
      'on',
      DateTime.now()
        .plus(duration)
        .toLocaleString(DateTime.DATETIME_HUGE_WITH_SECONDS)
    )
    return this.homey.setTimeout(callback, Number(duration))
  }

  log(...args: any[]): void {
    super.log(this.getName(), '-', ...args)
  }

  error(...args: any[]): void {
    super.error(this.getName(), '-', ...args)
  }
}
