import 'source-map-support/register'

import MELCloudDeviceMixin from '../../mixins/device_mixin'
import MELCloudDriverAta from './driver'
import { Capabilities, ReportCapabilities, ReportData, SetCapabilities } from '../../types'

const setCapabilityMappingAta = {
  onoff: { tag: 'Power', effectiveFlag: BigInt(0x1) },
  operation_mode: { tag: 'OperationMode', effectiveFlag: BigInt(0x2) },
  target_temperature: { tag: 'SetTemperature', effectiveFlag: BigInt(0x4) },
  fan_power: { tag: 'SetFanSpeed', effectiveFlag: BigInt(0x8) },
  vertical: { tag: 'VaneVertical', effectiveFlag: BigInt(0x10) },
  horizontal: { tag: 'VaneHorizontal', effectiveFlag: BigInt(0x100) }
} as const

const getCapabilityMappingAta = {
  measure_temperature: { tag: 'RoomTemperature' }
} as const

const listCapabilityMappingAta = {
  'measure_power.wifi': { tag: 'WifiSignalStrength' }
} as const

function reverse (mapping: any): any {
  const reversedMapping: any = {}
  Object.keys(mapping).forEach((key: any) => {
    reversedMapping[mapping[key]] = key
  })
  return reversedMapping
}

const operationModeFromDevice: { [key: number]: string } = {
  1: 'heat',
  2: 'dry',
  3: 'cool',
  7: 'fan',
  8: 'auto'
} as const

const operationModeToDevice = reverse(operationModeFromDevice)

const verticalFromDevice: { [key: number]: string } = {
  0: 'auto',
  1: 'top',
  2: 'middletop',
  3: 'middle',
  4: 'middlebottom',
  5: 'bottom',
  7: 'swing'
} as const

const verticalToDevice = reverse(verticalFromDevice)

const horizontalFromDevice: { [key: number]: string } = {
  0: 'auto',
  1: 'left',
  2: 'middleleft',
  3: 'middle',
  4: 'middleright',
  5: 'right',
  8: 'split',
  12: 'swing'
} as const

const horizontalToDevice = reverse(horizontalFromDevice)

export default class MELCloudDeviceAta extends MELCloudDeviceMixin {
  driver!: MELCloudDriverAta
  diff!: SetCapabilities<MELCloudDeviceAta>

  async onInit (): Promise<void> {
    this.setCapabilityMapping = setCapabilityMappingAta
    this.getCapabilityMapping = getCapabilityMappingAta
    this.listCapabilityMapping = listCapabilityMappingAta
    await super.onInit()
  }

  async handleCapabilities (): Promise<void> {
    const currentCapabilities = this.getCapabilities()
    for (const capability of currentCapabilities) {
      if (!this.requiredCapabilities.includes(capability)) {
        await this.removeCapability(capability)
      }
    }
    for (const capability of this.requiredCapabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability)
      }
    }
  }

  registerCapabilityListeners (): void {
    super.registerCapabilityListeners()
    this.registerCapabilityListener('thermostat_mode', async (value) => {
      await this.onCapability('thermostat_mode', value)
    })
  }

  async onCapability (capability: keyof SetCapabilities<MELCloudDeviceAta> | 'thermostat_mode', value: boolean | number | string): Promise<void> {
    this.homey.clearTimeout(this.syncTimeout)

    switch (capability) {
      case 'onoff':
        if (this.getSetting('always_on') === true) {
          await this.setWarning('Setting `Always On` is activated')
          await this.setWarning(null)
        }
        this.diff[capability] = value as boolean
        break
      case 'thermostat_mode':
        this.diff.onoff = value as string !== 'off'
        if (value as string !== 'off') {
          this.diff.operation_mode = value as string
        }
        break
      case 'operation_mode':
        if (['dry', 'fan'].includes(value as string) && this.getCapabilityValue('thermostat_mode') !== 'off') {
          await this.setWarning(`\`${value as string}\` has been saved (even if \`heat\` is displayed)`)
          await this.setWarning(null)
        }
        this.diff[capability] = value as string
        break
      case 'vertical':
      case 'horizontal':
        this.diff[capability] = value as string
        break
      case 'target_temperature':
      case 'fan_power':
        this.diff[capability] = value as number
        break
      default:
        this.error('Unknown capability', capability, '- with value', value)
    }

    this.syncTimeout = this.homey.setTimeout(async () => {
      await this.syncDataToDevice(this.diff)
    }, 1 * 1000)
  }

  getCapabilityValueToDevice (capability: keyof SetCapabilities<MELCloudDeviceAta>, value?: boolean | number | string): boolean | number {
    const newValue: boolean | number | string = value ?? this.getCapabilityValue(capability)
    switch (capability) {
      case 'onoff':
        return this.getSetting('always_on') === true ? true : newValue as boolean
      case 'operation_mode':
        return operationModeToDevice[newValue as keyof typeof operationModeToDevice]
      case 'vertical':
        return verticalToDevice[newValue as keyof typeof verticalToDevice]
      case 'horizontal':
        return horizontalToDevice[newValue as keyof typeof horizontalToDevice]
      default:
        return newValue as number
    }
  }

  async setCapabilityValueFromDevice (capability: keyof Capabilities<MELCloudDeviceAta>, value: boolean | number): Promise<void> {
    let newValue: boolean | number | string = value
    switch (capability) {
      case 'onoff':
        if (this.getSetting('always_on') === true && newValue === false) {
          await this.setSettings({ always_on: false })
        }
        break
      case 'operation_mode':
        newValue = operationModeFromDevice[newValue as keyof typeof operationModeFromDevice]
        break
      case 'vertical':
        newValue = verticalFromDevice[newValue as keyof typeof verticalFromDevice]
        break
      case 'horizontal':
        newValue = horizontalFromDevice[newValue as keyof typeof horizontalFromDevice]
        break
      default:
    }
    await this.setOrNotCapabilityValue(capability, newValue)
  }

  async customUpdate (): Promise<void> {
    const isOn: boolean = this.getCapabilityValue('onoff')
    let operationMode: string = this.getCapabilityValue('operation_mode')
    if (!isOn || ['dry', 'fan'].includes(operationMode)) {
      operationMode = 'off'
    }
    await this.setOrNotCapabilityValue('thermostat_mode', operationMode)
  }

  async runEnergyReports (): Promise<void> {
    const report: { daily: ReportData<MELCloudDeviceAta> | {}, total: ReportData<MELCloudDeviceAta> | {} } = {
      daily: await this.app.reportEnergyCost(this, true),
      total: await this.app.reportEnergyCost(this, false)
    }

    const reportMapping: ReportCapabilities<MELCloudDeviceAta> = {
      'meter_power.daily_consumed': 0,
      'meter_power.daily_consumed_auto': 0,
      'meter_power.daily_consumed_cooling': 0,
      'meter_power.daily_consumed_dry': 0,
      'meter_power.daily_consumed_fan': 0,
      'meter_power.daily_consumed_heating': 0,
      'meter_power.daily_consumed_other': 0,
      'meter_power.total_consumed': 0,
      'meter_power.total_consumed_auto': 0,
      'meter_power.total_consumed_cooling': 0,
      'meter_power.total_consumed_dry': 0,
      'meter_power.total_consumed_fan': 0,
      'meter_power.total_consumed_heating': 0,
      'meter_power.total_consumed_other': 0
    }
    Object.entries(report).forEach((entry: [string, ReportData<MELCloudDeviceAta> | {}]) => {
      const [period, data]: [string, ReportData<MELCloudDeviceAta> | {}] = entry
      if ('UsageDisclaimerPercentages' in data) {
        const deviceCount: number = typeof data.UsageDisclaimerPercentages === 'string'
          ? data.UsageDisclaimerPercentages.split(', ').length
          : 1;
        ['Auto', 'Cooling', 'Dry', 'Fan', 'Heating', 'Other'].forEach((mode: string) => {
          reportMapping[`meter_power.${period}_consumed_${mode.toLowerCase()}` as keyof ReportCapabilities<MELCloudDeviceAta>] = data[`Total${mode}Consumed` as keyof ReportData<MELCloudDeviceAta>] as number / deviceCount
          reportMapping[`meter_power.${period}_consumed` as keyof ReportCapabilities<MELCloudDeviceAta>] += reportMapping[`meter_power.${period}_consumed_${mode.toLowerCase()}` as keyof ReportCapabilities<MELCloudDeviceAta>]
        })
      }
    })

    for (const capability in reportMapping) {
      await this.setCapabilityValueFromDevice(capability as keyof Capabilities<MELCloudDeviceAta>, reportMapping[capability as keyof ReportCapabilities<MELCloudDeviceAta>])
    }
  }
}

module.exports = MELCloudDeviceAta
