import {
  type DeviceDataFromList,
  type OpCapabilities,
  type ReportPlanParameters,
  type SetCapabilities,
  type SetDeviceData,
  ThermostatMode,
  type WithoutEffectiveFlags,
} from '../../types/types'
import {
  Horizontal,
  OperationMode,
  Vertical,
} from '../../types/MELCloudAPITypes'
import type AtaDriver from './driver'
import BaseMELCloudDevice from '../../bases/device'

const isThermostatMode = (
  value: keyof typeof OperationMode,
): value is ThermostatMode & keyof typeof OperationMode =>
  value in ThermostatMode

export = class AtaDevice extends BaseMELCloudDevice<AtaDriver> {
  protected readonly reportPlanParameters: ReportPlanParameters = {
    duration: { hours: 1 },
    interval: { hours: 1 },
    minus: { hours: 1 },
    values: { millisecond: 0, minute: 5, second: 0 },
  }

  protected async specificOnCapability<
    K extends keyof SetCapabilities<AtaDriver>,
  >(capability: K, value: SetCapabilities<AtaDriver>[K]): Promise<void> {
    if (capability === 'thermostat_mode') {
      const isOn: boolean = value !== ThermostatMode.off
      this.diff.set('onoff', isOn)
      if (isOn) {
        this.diff.set('operation_mode', value)
      }
      await this.setAlwaysOnWarning()
    } else {
      this.diff.set(capability, value)
      if (
        capability === 'operation_mode' &&
        !isThermostatMode(value as keyof typeof OperationMode) &&
        this.getCapabilityValue('thermostat_mode') !== ThermostatMode.off
      ) {
        await this.setDisplayErrorWarning()
      }
    }
  }

  protected convertToDevice<K extends keyof SetCapabilities<AtaDriver>>(
    capability: K,
    value: SetCapabilities<AtaDriver>[K],
  ): WithoutEffectiveFlags<SetDeviceData<AtaDriver>> {
    switch (capability) {
      case 'onoff':
        return this.getSetting('always_on') || (value as boolean)
      case 'operation_mode':
        return OperationMode[value as keyof typeof OperationMode]
      case 'vertical':
        return Vertical[value as keyof typeof Vertical]
      case 'horizontal':
        return Horizontal[value as keyof typeof Horizontal]
      default:
        return value as WithoutEffectiveFlags<SetDeviceData<AtaDriver>>
    }
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  protected convertFromDevice<K extends keyof OpCapabilities<AtaDriver>>(
    capability: K,
    value: WithoutEffectiveFlags<DeviceDataFromList<AtaDriver>>,
  ): OpCapabilities<AtaDriver>[K] {
    switch (capability) {
      case 'operation_mode':
        return OperationMode[
          value as OperationMode
        ] as OpCapabilities<AtaDriver>[K]
      case 'vertical':
        return Vertical[value as Vertical] as OpCapabilities<AtaDriver>[K]
      case 'horizontal':
        return Horizontal[value as Horizontal] as OpCapabilities<AtaDriver>[K]
      default:
        return value as OpCapabilities<AtaDriver>[K]
    }
  }

  protected async updateThermostatMode(): Promise<void> {
    const isOn: boolean = this.getCapabilityValue('onoff')
    const operationMode: keyof typeof OperationMode =
      this.getCapabilityValue('operation_mode')
    await this.setCapabilityValue(
      'thermostat_mode',
      isOn && isThermostatMode(operationMode)
        ? operationMode
        : ThermostatMode.off,
    )
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  protected async updateStore(): Promise<void> {
    // Not implemented.
  }
}
