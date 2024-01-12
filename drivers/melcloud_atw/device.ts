import { DateTime } from 'luxon'
import BaseMELCloudDevice, { K_MULTIPLIER } from '../../bases/device'
import type AtwDriver from './driver'
import {
  OperationModeState,
  OperationModeZone,
  type Capability,
  type CapabilityValue,
  type DeviceValue,
  type ReportPlanParameters,
  type SetCapability,
  type SetDeviceValue,
  type Store,
} from '../../types'

const CURVE_VALUE: OperationModeZone = OperationModeZone.curve
const ROOM_VALUES: OperationModeZone[] = [
  OperationModeZone.room,
  OperationModeZone.room_cool,
]
const ROOM_FLOW_GAP: number = OperationModeZone.flow
const HEAT_COOL_GAP: number = OperationModeZone.room_cool

export = class AtwDevice extends BaseMELCloudDevice<AtwDriver> {
  protected readonly reportPlanParameters: ReportPlanParameters = {
    minus: { days: 1 },
    interval: { days: 1 },
    duration: { days: 1 },
    values: { hour: 1, minute: 10, second: 0, millisecond: 0 },
  }

  protected async specificOnCapability(
    capability: SetCapability<AtwDriver>,
    value: CapabilityValue,
  ): Promise<void> {
    this.diff.set(capability, value)
    if (capability.startsWith('operation_mode_zone')) {
      await this.handleOperationModeZones(capability, value as string)
    }
  }

  protected async handleOperationModeZones(
    capability: SetCapability<AtwDriver>,
    value: string,
  ): Promise<void> {
    const { canCool, hasZone2 } = this.getStore() as Store
    if (!hasZone2) {
      return
    }
    const zoneValue: OperationModeZone =
      OperationModeZone[value as keyof typeof OperationModeZone]
    const otherZoneCapability: SetCapability<AtwDriver> = (
      capability.endsWith('.zone2')
        ? capability.replace(/.zone2$/, '')
        : `${capability}.zone2`
    ) as SetCapability<AtwDriver>
    let otherZoneValue: OperationModeZone =
      OperationModeZone[
        this.getRequestedOrCurrentValue(
          otherZoneCapability,
        ) as keyof typeof OperationModeZone
      ]
    if (canCool) {
      if (zoneValue > CURVE_VALUE) {
        otherZoneValue =
          otherZoneValue === CURVE_VALUE
            ? HEAT_COOL_GAP
            : otherZoneValue + HEAT_COOL_GAP
      } else if (otherZoneValue > CURVE_VALUE) {
        otherZoneValue -= HEAT_COOL_GAP
      }
    }
    if (ROOM_VALUES.includes(zoneValue) && otherZoneValue === zoneValue) {
      otherZoneValue += ROOM_FLOW_GAP
    }
    this.diff.set(otherZoneCapability, OperationModeZone[otherZoneValue])
    await this.setDisplayErrorWarning()
  }

  protected convertToDevice(
    capability: SetCapability<AtwDriver>,
    value: CapabilityValue,
  ): SetDeviceValue {
    switch (true) {
      case capability === 'onoff':
        return this.getSetting('always_on') === true || (value as boolean)
      case capability.startsWith('operation_mode_zone'):
        return OperationModeZone[value as keyof typeof OperationModeZone]
      default:
        return value as SetDeviceValue
    }
  }

  protected convertFromDevice(
    capability: Capability<AtwDriver>,
    value: DeviceValue,
  ): CapabilityValue {
    switch (true) {
      case capability === 'alarm_generic.defrost_mode':
        return !!(value as number)
      case capability === 'last_legionella':
        return DateTime.fromISO(value as string, {
          locale: this.app.getLanguage(),
        }).toLocaleString({ weekday: 'short', day: 'numeric', month: 'short' })
      case capability === 'measure_power':
      case capability === 'measure_power.produced':
        return (value as number) * K_MULTIPLIER
      case capability === 'operation_mode_state':
        return OperationModeState[value as OperationModeState]
      case capability.startsWith('operation_mode_state.zone'):
        return (value as boolean)
          ? OperationModeState[OperationModeState.idle]
          : (this.getCapabilityValue('operation_mode_state') as string)
      case capability.startsWith('operation_mode_zone'):
        return OperationModeZone[value as OperationModeZone]
      default:
        return value
    }
  }

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  protected async updateThermostatMode(): Promise<void> {
    // Not implemented.
  }
}
