// eslint-disable-next-line import/no-extraneous-dependencies
import { Driver } from 'homey'
import type PairSession from 'homey/lib/PairSession'
import type MELCloudApp from '../app'
import type MELCloudDeviceAta from '../drivers/melcloud/device'
import type MELCloudDeviceAtw from '../drivers/melcloud_atw/device'
import type {
  DeviceDetails,
  GetCapability,
  GetCapabilityMapping,
  ListCapability,
  ListCapabilityMapping,
  ListDevice,
  LoginCredentials,
  MELCloudDevice,
  ReportCapability,
  ReportCapabilityMapping,
  SetCapability,
  SetCapabilityMapping,
  Store,
} from '../types'

export default abstract class MELCloudDriverMixin extends Driver {
  app!: MELCloudApp

  deviceType!: number

  heatPumpType!: string

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

  async onInit(): Promise<void> {
    this.app = this.homey.app as MELCloudApp
  }

  onPair(session: PairSession): void {
    session.setHandler(
      'login',
      async (data: LoginCredentials): Promise<boolean> => this.app.login(data)
    )
    session.setHandler(
      'list_devices',
      async (): Promise<DeviceDetails[]> => this.discoverDevices()
    )
  }

  async discoverDevices<T extends MELCloudDevice>(): Promise<DeviceDetails[]> {
    this.app.clearListDevicesRefresh()
    const devices: Array<ListDevice<T>> = await this.app.listDevices(
      this.deviceType
    )
    return devices.map(
      ({
        DeviceName,
        DeviceID,
        BuildingID,
        Device: { CanCool, HasZone2 },
      }): DeviceDetails => {
        const store: Store = {
          canCool: CanCool,
          hasZone2: HasZone2,
        }
        return {
          name: DeviceName,
          data: { id: DeviceID, buildingid: BuildingID },
          store,
          capabilities: this.getRequiredCapabilities(store),
        }
      }
    )
  }

  abstract getRequiredCapabilities(store: Store): string[]

  onRepair(session: PairSession): void {
    session.setHandler(
      'login',
      async (data: LoginCredentials): Promise<boolean> => this.app.login(data)
    )
  }
}
