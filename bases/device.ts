import type {
  Capabilities,
  CapabilitiesOptions,
  ConvertFromDevice,
  ConvertToDevice,
  DeviceDetails,
  GetCapabilityTagMapping,
  ListCapabilityTagMapping,
  MELCloudDriver,
  OpCapabilities,
  OpCapabilityTagEntry,
  OpDeviceData,
  ReportCapabilities,
  ReportCapabilityTagEntry,
  ReportCapabilityTagMapping,
  ReportPlanParameters,
  SetCapabilities,
  SetCapabilityTagMapping,
  Settings,
  Store,
} from '../types'
import {
  type DeviceData,
  type DeviceType,
  FLAG_UNCHANGED,
  type ListDevice,
  type NonEffectiveFlagsKeyOf,
  type NonEffectiveFlagsValueOf,
  type ReportData,
  type SetDeviceData,
} from '@olivierzal/melcloud-api'
import { DateTime } from 'luxon'
import { Device } from 'homey'
import type MELCloudApp from '..'
import addToLogs from '../decorators/addToLogs'
import withTimers from '../mixins/withTimers'

export const K_MULTIPLIER = 1000

const NUMBER_0 = 0
const NUMBER_1 = 1
const YEAR_1970 = 1970

const isTotalEnergyKey = (key: string): boolean =>
  !key.startsWith('measure_power') && !key.includes('daily')

@addToLogs('getName()')
export default abstract class<
  T extends keyof typeof DeviceType,
> extends withTimers(Device) {
  public declare readonly driver: MELCloudDriver[T]

  protected readonly diff = new Map<
    keyof SetCapabilities[T],
    {
      initialValue: SetCapabilities[T][keyof SetCapabilities[T]]
      value: SetCapabilities[T][keyof SetCapabilities[T]]
    }
  >()

  #effectiveFlags!: Record<NonEffectiveFlagsKeyOf<SetDeviceData[T]>, number>

  #getCapabilityTagMapping: Partial<GetCapabilityTagMapping[T]> = {}

  #linkedDeviceCount = NUMBER_1

  #listCapabilityTagMapping: Partial<ListCapabilityTagMapping[T]> = {}

  #listOnlyCapabilityTagEntries: OpCapabilityTagEntry<T>[] = []

  #reportCapabilityTagEntries: {
    false?: ReportCapabilityTagEntry<T>[]
    true?: ReportCapabilityTagEntry<T>[]
  } = {}

  #setCapabilityTagMapping: Partial<SetCapabilityTagMapping[T]> = {}

  #syncToDeviceTimeout: NodeJS.Timeout | null = null

  readonly #app = this.homey.app as MELCloudApp

  readonly #data = this.getData() as DeviceDetails<T>['data']

  readonly #id = this.#data.id

  readonly #reportInterval: { false?: NodeJS.Timeout; true?: NodeJS.Timeout } =
    {}

  readonly #reportTimeout: {
    false: NodeJS.Timeout | null
    true: NodeJS.Timeout | null
  } = { false: null, true: null }

  protected abstract toDevice: Partial<
    Record<keyof SetCapabilities[T], ConvertToDevice<T>>
  >

  protected abstract readonly fromDevice: Partial<
    Record<keyof OpCapabilities[T], ConvertFromDevice<T>>
  >

  protected abstract readonly reportPlanParameters: ReportPlanParameters | null

  public get buildingid(): number {
    return this.#data.buildingid
  }

  public get id(): number {
    return this.#id
  }

  public override async addCapability(capability: string): Promise<void> {
    this.log('Adding capability', capability)
    if (!this.hasCapability(capability)) {
      await super.addCapability(capability)
      this.log('Capability', capability, 'added')
    }
  }

  public override getCapabilityOptions<
    K extends Extract<keyof CapabilitiesOptions[T], string>,
  >(capability: K): CapabilitiesOptions[T][K] {
    return super.getCapabilityOptions(capability) as CapabilitiesOptions[T][K]
  }

  public override getCapabilityValue<K extends keyof Capabilities[T]>(
    capability: K & string,
  ): NonNullable<Capabilities[T][K]> {
    return super.getCapabilityValue(capability) as NonNullable<
      Capabilities[T][K]
    >
  }

  public override getSetting<K extends Extract<keyof Settings, string>>(
    setting: K,
  ): NonNullable<Settings[K]> {
    return super.getSetting(setting) as NonNullable<Settings[K]>
  }

  public override getStoreValue<K extends Extract<keyof Store[T], string>>(
    key: K,
  ): Store[T][K] {
    return super.getStoreValue(key) as Store[T][K]
  }

  public override onDeleted(): void {
    this.homey.clearTimeout(this.#syncToDeviceTimeout)
    this.homey.clearTimeout(this.#reportTimeout.false)
    this.homey.clearTimeout(this.#reportTimeout.true)
    this.homey.clearInterval(this.#reportInterval.false)
    this.homey.clearInterval(this.#reportInterval.true)
  }

  public override async onInit(): Promise<void> {
    this.#effectiveFlags = this.driver.effectiveFlags as Record<
      NonEffectiveFlagsKeyOf<SetDeviceData[T]>,
      number
    >
    this.toDevice = {
      onoff: (onoff: boolean): boolean => this.getSetting('always_on') || onoff,
      ...this.toDevice,
    }
    await this.setWarning(null)
    await this.#handleStore()
    await this.#handleCapabilities()
    this.registerCapabilityListeners()
    await this.syncFromDevice()
    await this.#runEnergyReports()
  }

  public override async onSettings({
    changedKeys,
    newSettings,
  }: {
    changedKeys: string[]
    newSettings: Settings
  }): Promise<void> {
    const changedCapabilities = changedKeys.filter(
      (setting) =>
        this.#isCapability(setting) &&
        typeof newSettings[setting] === 'boolean',
    )
    if (changedCapabilities.length) {
      await this.#handleOptionalCapabilities(newSettings, changedCapabilities)
      await this.setWarning(this.homey.__('warnings.dashboard'))
    }
    if (
      changedKeys.includes('always_on') &&
      newSettings.always_on === true &&
      this.getCapabilityValue('onoff')
    ) {
      await this.triggerCapabilityListener('onoff', true)
    } else if (
      changedKeys.some(
        (setting) =>
          setting !== 'always_on' &&
          !(setting in this.driver.reportCapabilityTagMapping),
      )
    ) {
      await this.syncFromDevice()
    }

    const changedEnergyKeys = changedCapabilities.filter((setting) =>
      this.#isReportCapability(setting),
    )
    if (changedEnergyKeys.length) {
      await Promise.all(
        [false, true].map(async (total) => {
          if (
            changedEnergyKeys.some(
              (setting) => isTotalEnergyKey(setting) === total,
            )
          ) {
            this.#setReportCapabilityTagEntries(total)
            await this.#runEnergyReport(total)
          }
        }),
      )
    }
  }

  public override async onUninit(): Promise<void> {
    this.onDeleted()
    return Promise.resolve()
  }

  public override async removeCapability(capability: string): Promise<void> {
    this.log('Removing capability', capability)
    if (this.hasCapability(capability)) {
      await super.removeCapability(capability)
      this.log('Capability', capability, 'removed')
    }
  }

  public override async setCapabilityOptions<
    K extends Extract<keyof CapabilitiesOptions[T], string>,
  >(capability: K, options: CapabilitiesOptions[T][K] & object): Promise<void> {
    await super.setCapabilityOptions(capability, options)
  }

  public override async setCapabilityValue<
    K extends Extract<keyof Capabilities[T], string>,
  >(capability: K, value: Capabilities[T][K]): Promise<void> {
    this.log('Capability', capability, 'is', value)
    if (value !== this.getCapabilityValue(capability)) {
      await super.setCapabilityValue(capability, value)
    }
  }

  public override async setStoreValue<K extends keyof Store[T]>(
    key: Extract<K, string>,
    value: Store[T][K],
  ): Promise<void> {
    this.log('Store', key, 'is', value)
    if (value !== super.getStoreValue(key)) {
      await super.setStoreValue(key, value)
    }
  }

  public override async setWarning(warning: string | null): Promise<void> {
    if (warning !== null) {
      await super.setWarning(warning)
    }
    await super.setWarning(null)
  }

  public async syncFromDevice(): Promise<void> {
    const data = this.#app.devices[this.#id]?.Device ?? null
    this.log('Syncing from device list:', data)
    await this.setCapabilities(data)
  }

  protected applySyncToDevice(): void {
    this.#syncToDeviceTimeout = this.setTimeout(
      async (): Promise<void> => {
        await this.setCapabilities(await this.#deviceData())
        this.#syncToDeviceTimeout = null
      },
      { seconds: 1 },
      { actionType: 'sync to device', units: ['seconds'] },
    )
  }

  protected clearSyncToDevice(): void {
    this.homey.clearTimeout(this.#syncToDeviceTimeout)
    this.#syncToDeviceTimeout = null
    this.log('Sync to device has been paused')
  }

  protected getRequestedOrCurrentValue<
    K extends Extract<keyof SetCapabilities[T], string>,
  >(capability: K): NonNullable<SetCapabilities[T][K]> {
    return (this.diff.get(capability)?.value ??
      this.getCapabilityValue(capability)) as NonNullable<SetCapabilities[T][K]>
  }

  protected onCapability<K extends Extract<keyof SetCapabilities[T], string>>(
    capability: K,
    value: SetCapabilities[T][K],
  ): void {
    this.setDiff(capability, value)
  }

  protected registerCapabilityListeners<
    K extends Extract<keyof SetCapabilities[T], string>,
  >(): void {
    Object.keys(this.#setCapabilityTagMapping).forEach((capability) => {
      this.registerCapabilityListener(
        capability,
        (value: SetCapabilities[T][K]) => {
          this.clearSyncToDevice()
          this.onCapability(capability as K, value)
          this.applySyncToDevice()
        },
      )
    })
  }

  protected async setCapabilities<
    D extends DeviceData[T] | ListDevice[T]['Device'],
    K extends Extract<keyof OpCapabilities[T], string>,
  >(data: D | null): Promise<void> {
    if (data) {
      await Promise.all(
        this.#getUpdateCapabilityTagEntries(data.EffectiveFlags).map(
          async ([capability, tag]) => {
            if (tag in data) {
              const value = this.#convertFromDevice(
                capability,
                data[tag as keyof D] as
                  | NonEffectiveFlagsValueOf<DeviceData[T]>
                  | NonEffectiveFlagsValueOf<ListDevice[T]['Device']>,
              )
              await this.setCapabilityValue(
                capability,
                value as Capabilities[T][K],
              )
            }
          },
        ),
      )
    }
  }

  protected setDiff<K extends Extract<keyof SetCapabilities[T], string>>(
    capability: K,
    value: SetCapabilities[T][K],
  ): void {
    if (this.diff.has(capability)) {
      const diff = this.diff.get(capability)
      if (value === diff?.initialValue) {
        this.diff.delete(capability)
      } else if (diff) {
        diff.value = value
      }
      return
    }
    this.diff.set(capability, {
      initialValue: this.getCapabilityValue(capability),
      value,
    })
  }

  #buildUpdateData<
    K extends Extract<keyof SetCapabilities[T], string>,
  >(): SetDeviceData[T] {
    this.#setAlwaysOnWarning()
    return Object.entries(this.#setCapabilityTagMapping).reduce<
      SetDeviceData[T]
    >(
      (
        acc,
        [capability, tag]: [string, NonEffectiveFlagsKeyOf<SetDeviceData[T]>],
      ) => {
        acc[tag] = this.#convertToDevice(capability as K)
        if (this.diff.has(capability as K)) {
          acc.EffectiveFlags = Number(
            BigInt(acc.EffectiveFlags) | BigInt(this.#effectiveFlags[tag]),
          )
          this.diff.delete(capability as K)
        }
        return acc
      },
      { EffectiveFlags: FLAG_UNCHANGED },
    )
  }

  #calculateCopValue<
    K extends keyof ReportData[T],
    L extends keyof ReportCapabilities[T],
  >(data: ReportData[T], capability: L & string): number {
    const producedTags = this.driver.producedTagMapping[capability] as K[]
    const consumedTags = this.driver.consumedTagMapping[capability] as K[]
    return (
      producedTags.reduce<number>(
        (acc, tag) => acc + (data[tag] as number),
        NUMBER_0,
      ) /
      (consumedTags.length ?
        consumedTags.reduce<number>(
          (acc, tag) => acc + (data[tag] as number),
          NUMBER_0,
        )
      : NUMBER_1)
    )
  }

  #calculateEnergyValue<K extends keyof ReportData[T]>(
    data: ReportData[T],
    tags: K[],
  ): number {
    return (
      tags.reduce<number>((acc, tag) => acc + (data[tag] as number), NUMBER_0) /
      this.#linkedDeviceCount
    )
  }

  #calculatePowerValue<K extends keyof ReportData[T]>(
    data: ReportData[T],
    tags: K[],
    toDate: DateTime,
  ): number {
    return (
      tags.reduce<number>(
        (acc, tag) => acc + (data[tag] as number[])[toDate.hour] * K_MULTIPLIER,
        NUMBER_0,
      ) / this.#linkedDeviceCount
    )
  }

  #cleanMapping<
    M extends
      | GetCapabilityTagMapping[T]
      | ListCapabilityTagMapping[T]
      | ReportCapabilityTagMapping[T]
      | SetCapabilityTagMapping[T],
  >(capabilityTagMapping: M): Partial<M> {
    return Object.fromEntries(
      Object.entries(capabilityTagMapping).filter(([capability]) =>
        this.hasCapability(capability),
      ),
    ) as Partial<M>
  }

  #clearEnergyReportPlan(total = false): void {
    const totalString = String(total) as `${boolean}`
    this.homey.clearTimeout(this.#reportTimeout[totalString])
    this.homey.clearInterval(this.#reportInterval[totalString])
    this.#reportTimeout[totalString] = null
    this.log(total ? 'Total' : 'Regular', 'energy report has been stopped')
  }

  #convertFromDevice<K extends keyof OpCapabilities[T]>(
    capability: K,
    value:
      | NonEffectiveFlagsValueOf<DeviceData[T]>
      | NonEffectiveFlagsValueOf<ListDevice[T]['Device']>,
  ): OpCapabilities[T][K] {
    return (this.fromDevice[capability]?.(value) ??
      value) as OpCapabilities[T][K]
  }

  #convertToDevice<K extends Extract<keyof SetCapabilities[T], string>>(
    capability: K,
  ): NonEffectiveFlagsValueOf<SetDeviceData[T]> {
    const value = this.getRequestedOrCurrentValue(capability)
    return (
      this.toDevice[capability]?.(value) ??
      (value as NonEffectiveFlagsValueOf<SetDeviceData[T]>)
    )
  }

  async #deviceData(): Promise<DeviceData[T] | null> {
    const updateData = this.#buildUpdateData()
    if (updateData.EffectiveFlags !== FLAG_UNCHANGED) {
      try {
        return (
          await this.#app.melcloudAPI.set(this.driver.heatPumpType, {
            DeviceID: this.id,
            HasPendingCommand: true,
            ...updateData,
          })
        ).data as DeviceData[T]
      } catch (_error) {
        return null
      }
    }
    return null
  }

  #getUpdateCapabilityTagEntries(
    effectiveFlags: number,
  ): OpCapabilityTagEntry<T>[] {
    switch (true) {
      case effectiveFlags !== FLAG_UNCHANGED:
        return [
          ...Object.entries(this.#setCapabilityTagMapping).filter(
            ([, tag]: [string, NonEffectiveFlagsKeyOf<SetDeviceData[T]>]) =>
              BigInt(effectiveFlags) & BigInt(this.#effectiveFlags[tag]),
          ),
          ...Object.entries(this.#getCapabilityTagMapping),
        ] as OpCapabilityTagEntry<T>[]
      case Boolean(this.diff.size):
      case this.#syncToDeviceTimeout !== null:
        return this.#listOnlyCapabilityTagEntries
      default:
        return Object.entries({
          ...this.#setCapabilityTagMapping,
          ...this.#getCapabilityTagMapping,
          ...this.#listCapabilityTagMapping,
        }) as OpCapabilityTagEntry<T>[]
    }
  }

  async #handleCapabilities(): Promise<void> {
    const settings = this.getSettings() as Settings
    const capabilities = [
      ...(this.driver.getRequiredCapabilities as (store: Store[T]) => string[])(
        this.getStore() as Store[T],
      ),
      ...Object.keys(settings).filter(
        (setting) =>
          this.#isCapability(setting) &&
          typeof settings[setting] === 'boolean' &&
          settings[setting],
      ),
    ]
    await capabilities.reduce<Promise<void>>(async (acc, capability) => {
      await acc
      return this.addCapability(capability)
    }, Promise.resolve())
    await this.getCapabilities()
      .filter((capability) => !capabilities.includes(capability))
      .reduce<Promise<void>>(async (acc, capability) => {
        await acc
        await this.removeCapability(capability)
      }, Promise.resolve())
    this.#setCapabilityTagMappings()
    this.#setReportCapabilityTagEntries()
  }

  async #handleOptionalCapabilities(
    newSettings: Settings,
    changedCapabilities: string[],
  ): Promise<void> {
    await changedCapabilities.reduce<Promise<void>>(async (acc, capability) => {
      await acc
      if (newSettings[capability] === true) {
        await this.addCapability(capability)
        return
      }
      await this.removeCapability(capability)
    }, Promise.resolve())
    if (
      changedCapabilities.some(
        (capability) => !this.#isReportCapability(capability),
      )
    ) {
      this.#setListCapabilityTagMappings()
    }
  }

  async #handleStore<
    K extends Extract<keyof Store[T], string>,
  >(): Promise<void> {
    const data = this.#app.devices[this.#id]?.Device ?? null
    if (data) {
      await Promise.all(
        Object.entries(
          this.driver.getStore(
            data as ListDevice['Ata']['Device'] &
              ListDevice['Atw']['Device'] &
              ListDevice['Erv']['Device'],
          ),
        ).map(async ([key, value]) => {
          await this.setStoreValue(key as K, value as Store[T][keyof Store[T]])
        }),
      )
    }
  }

  #isCapability(setting: string): boolean {
    return this.driver.capabilities.includes(setting)
  }

  #isReportCapability(setting: string): boolean {
    return setting in this.driver.reportCapabilityTagMapping
  }

  #planEnergyReport(total = false): void {
    if (this.reportPlanParameters) {
      const totalString = String(total) as `${boolean}`
      if (!this.#reportTimeout[totalString]) {
        const actionType = `${total ? 'total' : 'regular'} energy report`
        const { duration, interval, values } =
          total ?
            {
              duration: { days: 1 },
              interval: { days: 1 },
              values: { hour: 1, millisecond: 0, minute: 5, second: 0 },
            }
          : this.reportPlanParameters
        this.#reportTimeout[totalString] = this.setTimeout(
          async () => {
            await this.#runEnergyReport(total)
            this.#reportInterval[totalString] = this.setInterval(
              async () => {
                await this.#runEnergyReport(total)
              },
              interval,
              { actionType, units: ['days', 'hours'] },
            )
          },
          DateTime.now().plus(duration).set(values).diffNow(),
          { actionType, units: ['hours', 'minutes'] },
        )
      }
    }
  }

  async #reportEnergyCost(
    fromDate: DateTime,
    toDate: DateTime,
  ): Promise<ReportData[T] | null> {
    try {
      return (
        await this.#app.melcloudAPI.report({
          DeviceID: this.#id,
          FromDate: fromDate.toISODate() ?? '',
          ToDate: toDate.toISODate() ?? '',
          UseCurrency: false,
        })
      ).data as ReportData[T]
    } catch (_error) {
      return null
    }
  }

  async #runEnergyReport(total = false): Promise<void> {
    if (this.reportPlanParameters) {
      if (
        !(this.#reportCapabilityTagEntries[String(total) as `${boolean}`] ?? [])
          .length
      ) {
        this.#clearEnergyReportPlan(total)
        return
      }
      const toDate = DateTime.now().minus(this.reportPlanParameters.minus)
      const fromDate = total ? DateTime.local(YEAR_1970) : toDate
      const data = await this.#reportEnergyCost(fromDate, toDate)
      await this.#setReportCapabilities(data, toDate, total)
      this.#planEnergyReport(total)
    }
  }

  async #runEnergyReports(): Promise<void> {
    await this.#runEnergyReport()
    await this.#runEnergyReport(true)
  }

  #setAlwaysOnWarning(): void {
    if (
      this.getSetting('always_on') &&
      this.diff.get('onoff')?.value === false
    ) {
      this.setWarning(this.homey.__('warnings.always_on')).catch(
        (error: unknown) => {
          this.error(error instanceof Error ? error.message : String(error))
        },
      )
    }
  }

  #setCapabilityTagMappings(): void {
    this.#setCapabilityTagMapping = this.#cleanMapping(
      this.driver.setCapabilityTagMapping as SetCapabilityTagMapping[T],
    )
    this.#getCapabilityTagMapping = this.#cleanMapping(
      this.driver.getCapabilityTagMapping as GetCapabilityTagMapping[T],
    )
    this.#setListCapabilityTagMappings()
  }

  #setListCapabilityTagMappings<
    K extends Extract<keyof OpCapabilities[T], string>,
  >(): void {
    this.#listCapabilityTagMapping = this.#cleanMapping(
      this.driver.listCapabilityTagMapping as ListCapabilityTagMapping[T],
    )
    this.#listOnlyCapabilityTagEntries = (
      Object.entries(this.#listCapabilityTagMapping) as [K, OpDeviceData<T>][]
    ).filter(
      ([capability]) =>
        !Object.keys({
          ...this.#setCapabilityTagMapping,
          ...this.#getCapabilityTagMapping,
        }).includes(capability),
    )
  }

  async #setReportCapabilities(
    data: ReportData[T] | null,
    toDate: DateTime,
    total = false,
  ): Promise<void> {
    if (data) {
      if ('UsageDisclaimerPercentages' in data) {
        this.#linkedDeviceCount =
          data.UsageDisclaimerPercentages.split(',').length
      }
      await Promise.all(
        (
          this.#reportCapabilityTagEntries[String(total) as `${boolean}`] ?? []
        ).map(
          async <
            K extends Extract<keyof ReportCapabilities[T], string>,
            L extends keyof ReportData[T],
          >([capability, tags]: [K, L[]]) => {
            switch (true) {
              case capability.includes('cop'):
                await this.setCapabilityValue(
                  capability,
                  this.#calculateCopValue(
                    data,
                    capability,
                  ) as Capabilities[T][K],
                )
                break
              case capability.startsWith('measure_power'):
                await this.setCapabilityValue(
                  capability,
                  this.#calculatePowerValue(
                    data,
                    tags,
                    toDate,
                  ) as Capabilities[T][K],
                )
                break
              default:
                await this.setCapabilityValue(
                  capability,
                  this.#calculateEnergyValue(data, tags) as Capabilities[T][K],
                )
            }
          },
        ),
      )
    }
  }

  #setReportCapabilityTagEntries(total?: boolean): void {
    const reportCapabilityTagEntries = Object.entries(
      this.#cleanMapping(
        this.driver.reportCapabilityTagMapping as ReportCapabilityTagMapping[T],
      ),
    ) as ReportCapabilityTagEntry<T>[]
    if (typeof total !== 'undefined') {
      this.#reportCapabilityTagEntries[String(total) as `${boolean}`] =
        reportCapabilityTagEntries.filter(
          ([capability]) => isTotalEnergyKey(capability) === total,
        )
      return
    }
    this.#reportCapabilityTagEntries = Object.groupBy<
      `${boolean}`,
      ReportCapabilityTagEntry<T>
    >(
      reportCapabilityTagEntries,
      ([capability]) => String(isTotalEnergyKey(capability)) as `${boolean}`,
    )
  }
}
