import type Homey from 'homey/lib/Homey'

import {
  type AreaFacade,
  type BuildingFacade,
  type ErrorData,
  type FloorFacade,
  type FrostProtectionData,
  type GroupAtaState,
  type HolidayModeData,
  type LoginCredentials,
  AreaModel,
  BuildingModel,
  DeviceModel,
  FloorModel,
  Horizontal,
  OperationMode,
  Vertical,
} from '@olivierzal/melcloud-api'
import power from 'homey-lib/assets/capability/capabilities/onoff.json'
import targetTemperature from 'homey-lib/assets/capability/capabilities/target_temperature.json'
import thermostatMode from 'homey-lib/assets/capability/capabilities/thermostat_mode.json'
import { DateTime } from 'luxon'

import type MELCloudApp from '.'
import type {
  Building,
  DeviceSettings,
  DriverCapabilitiesOptions,
  DriverSetting,
  ErrorLog,
  ErrorLogQuery,
  FrostProtectionSettings,
  HolidayModeSettings,
  LoginSetting,
  Manifest,
  ManifestDriver,
  ManifestDriverCapabilitiesOptions,
  PairSetting,
  Settings,
} from './types'

import fan from './.homeycompose/capabilities/fan_power.json'
import horizontal from './.homeycompose/capabilities/horizontal.json'
import vertical from './.homeycompose/capabilities/vertical.json'

const DEFAULT_LIMIT = 1
const DEFAULT_OFFSET = 0
const YEAR_1 = 1

const modelClass = {
  areas: AreaModel,
  buildings: BuildingModel,
  floors: FloorModel,
}

const getFacade = (
  homey: Homey,
  zoneType: keyof typeof modelClass,
  id: number,
): AreaFacade | BuildingFacade | FloorFacade => {
  const model = modelClass[zoneType].getById(id)
  if (!model) {
    throw new Error(homey.__('settings.buildings.zone.not_found'))
  }
  return (homey.app as MELCloudApp).facadeManager.get(model)
}

const formatErrors = (errors: Record<string, readonly string[]>): string =>
  Object.entries(errors)
    .map(([error, messages]) => `${error}: ${messages.join(', ')}`)
    .join('\n')

const handleResponse = (
  errors: Record<string, readonly string[]> | null,
): void => {
  if (errors) {
    throw new Error(formatErrors(errors))
  }
}

const getErrors = async (
  homey: Homey,
  fromDate: DateTime,
  toDate: DateTime,
): Promise<ErrorData[]> => {
  const { data } = await (homey.app as MELCloudApp).api.getErrors({
    postData: {
      DeviceIDs: DeviceModel.getAll().map(({ id }) => id),
      FromDate: fromDate.toISODate() ?? '',
      ToDate: toDate.toISODate() ?? '',
    },
  })
  if ('AttributeErrors' in data) {
    throw new Error(formatErrors(data.AttributeErrors))
  }
  return data
}

const getDriverSettings = (
  { id: driverId, settings }: ManifestDriver,
  language: string,
): DriverSetting[] =>
  (settings ?? []).flatMap((setting) =>
    (setting.children ?? []).map(
      ({ id, label, max, min, type, units, values }) => ({
        driverId,
        groupId: setting.id,
        groupLabel: setting.label[language] ?? setting.label.en,
        id,
        max,
        min,
        title: label[language] ?? label.en,
        type,
        units,
        values: values?.map(({ id: valueId, label: valueLabel }) => ({
          id: valueId,
          label: valueLabel[language] ?? valueLabel.en,
        })),
      }),
    ),
  )

const getDriverLoginSetting = (
  { id: driverId, pair }: ManifestDriver,
  language: string,
): DriverSetting[] => {
  const driverLoginSetting = pair?.find(
    (pairSetting: PairSetting): pairSetting is LoginSetting =>
      pairSetting.id === 'login',
  )
  return driverLoginSetting ?
      Object.values(
        Object.entries(driverLoginSetting.options).reduce<
          Record<string, DriverSetting>
        >((acc, [option, label]) => {
          const isPassword = option.startsWith('password')
          const key = isPassword ? 'password' : 'username'
          acc[key] ??= {
            driverId,
            groupId: 'login',
            id: key,
            title: '',
            type: isPassword ? 'password' : 'text',
          }
          acc[key][option.endsWith('Placeholder') ? 'placeholder' : 'title'] =
            label[language] ?? label.en
          return acc
        }, {}),
      )
    : []
}

const handleErrorLogQuery = ({
  from,
  limit,
  offset,
  to,
}: ErrorLogQuery): { fromDate: DateTime; period: number; toDate: DateTime } => {
  const fromDate =
    from !== undefined && from ? DateTime.fromISO(from) : undefined
  const toDate = to !== undefined && to ? DateTime.fromISO(to) : DateTime.now()

  let period = Number.parseInt(String(limit), 10)
  period = Number.isNaN(period) ? DEFAULT_LIMIT : period

  let daysOffset = Number.parseInt(String(offset), 10)
  daysOffset =
    fromDate || Number.isNaN(daysOffset) ? DEFAULT_OFFSET : daysOffset

  const daysLimit = fromDate ? DEFAULT_LIMIT : period
  const days = daysLimit * daysOffset + daysOffset
  return {
    fromDate: fromDate ?? toDate.minus({ days: days + daysLimit }),
    period,
    toDate: toDate.minus({ days }),
  }
}

const getLocalizedCapabilitiesOptions = (
  capabilitiesOptions: ManifestDriverCapabilitiesOptions,
  language: string,
  enumType?: typeof Horizontal | typeof OperationMode | typeof Vertical,
): DriverCapabilitiesOptions => ({
  title:
    capabilitiesOptions.title?.[
      language in (capabilitiesOptions.title ?? {}) ? language : 'en'
    ] ?? '',
  type: capabilitiesOptions.type ?? (capabilitiesOptions.values ? 'enum' : ''),
  values:
    capabilitiesOptions.values && enumType ?
      capabilitiesOptions.values.map(({ id, title }) => ({
        id: String(enumType[id as keyof typeof enumType]),
        label: title[language] ?? title.en,
      }))
    : undefined,
})

export = {
  getAtaCapabilities({
    homey,
  }: {
    homey: Homey
  }): Partial<Record<keyof GroupAtaState, DriverCapabilitiesOptions>> {
    const language = homey.i18n.getLanguage()
    return {
      FanSpeed: getLocalizedCapabilitiesOptions(fan, language),
      OperationMode: getLocalizedCapabilitiesOptions(
        {
          title: thermostatMode.title,
          values: (homey.manifest as Manifest).drivers
            .find(({ id }) => id === 'melcloud')
            ?.capabilitiesOptions?.thermostat_mode.values?.filter(
              ({ id }) => id !== 'off',
            ),
        },
        language,
        OperationMode,
      ),
      Power: getLocalizedCapabilitiesOptions(
        { title: power.title, type: power.type },
        language,
      ),
      SetTemperature: getLocalizedCapabilitiesOptions(
        { title: targetTemperature.title, type: targetTemperature.type },
        language,
      ),
      VaneHorizontalDirection: getLocalizedCapabilitiesOptions(
        horizontal,
        language,
        Horizontal,
      ),
      VaneVerticalDirection: getLocalizedCapabilitiesOptions(
        vertical,
        language,
        Vertical,
      ),
    }
  },
  async getAtaValues({
    homey,
    params: { zoneId, zoneType },
  }: {
    homey: Homey
    params: { zoneId: string; zoneType: keyof typeof modelClass }
  }): Promise<GroupAtaState> {
    return getFacade(homey, zoneType, Number(zoneId)).getAta()
  },
  getBuildings(): Building[] {
    return BuildingModel.getAll().map((building) => ({
      areas: building.areas.map((area) => ({
        id: area.id,
        name: area.name,
      })),
      floors: building.floors.map((floor) => ({
        areas: floor.areas,
        id: floor.id,
        name: floor.name,
      })),
      id: building.id,
      name: building.name,
    }))
  },
  getDeviceSettings({ homey }: { homey: Homey }): DeviceSettings {
    return (homey.app as MELCloudApp)
      .getDevices()
      .reduce<DeviceSettings>((acc, device) => {
        const driverId = device.driver.id
        acc[driverId] ??= {}
        Object.entries(device.getSettings() as Settings).forEach(
          ([settingId, value]) => {
            acc[driverId][settingId] ??= []
            if (!acc[driverId][settingId].includes(value)) {
              acc[driverId][settingId].push(value)
            }
          },
        )
        return acc
      }, {})
  },
  getDriverSettings({
    homey,
  }: {
    homey: Homey
  }): Partial<Record<string, DriverSetting[]>> {
    const language = homey.i18n.getLanguage()
    return Object.groupBy(
      (homey.manifest as Manifest).drivers.flatMap((driver) => [
        ...getDriverSettings(driver, language),
        ...getDriverLoginSetting(driver, language),
      ]),
      ({ driverId, groupId }) => groupId ?? driverId,
    )
  },
  async getErrors({
    homey,
    query,
  }: {
    homey: Homey
    query: ErrorLogQuery
  }): Promise<ErrorLog> {
    const { fromDate, period, toDate } = handleErrorLogQuery(query)
    const nextToDate = fromDate.minus({ days: 1 })
    return {
      errors: (await getErrors(homey, fromDate, toDate))
        .map(
          ({
            DeviceId: deviceId,
            ErrorMessage: errorMessage,
            StartDate: startDate,
          }) => ({
            date:
              DateTime.fromISO(startDate).year > YEAR_1 ?
                DateTime.fromISO(startDate, {
                  locale: homey.i18n.getLanguage(),
                }).toLocaleString(DateTime.DATETIME_MED)
              : '',
            device: DeviceModel.getById(deviceId)?.name ?? '',
            error: errorMessage?.trim() ?? '',
          }),
        )
        .filter((error) => error.date && error.error)
        .reverse(),
      fromDateHuman: fromDate
        .setLocale(homey.i18n.getLanguage())
        .toLocaleString(DateTime.DATE_FULL),
      nextFromDate: nextToDate.minus({ days: period }).toISODate() ?? '',
      nextToDate: nextToDate.toISODate() ?? '',
    }
  },
  async getFrostProtectionSettings({
    homey,
    params: { zoneId, zoneType },
  }: {
    homey: Homey
    params: { zoneId: string; zoneType: keyof typeof modelClass }
  }): Promise<FrostProtectionData> {
    return getFacade(homey, zoneType, Number(zoneId)).getFrostProtection()
  },
  async getHolidayModeSettings({
    homey,
    params: { zoneId, zoneType },
  }: {
    homey: Homey
    params: { zoneId: string; zoneType: keyof typeof modelClass }
  }): Promise<HolidayModeData> {
    return getFacade(homey, zoneType, Number(zoneId)).getHolidayMode()
  },
  getLanguage({ homey }: { homey: Homey }): string {
    return homey.i18n.getLanguage()
  },
  async login({
    body,
    homey,
  }: {
    body: LoginCredentials
    homey: Homey
  }): Promise<boolean> {
    return (homey.app as MELCloudApp).api.applyLogin(body)
  },
  async setAtaValues({
    body,
    homey,
    params: { zoneId, zoneType },
  }: {
    body: GroupAtaState
    homey: Homey
    params: { zoneId: string; zoneType: keyof typeof modelClass }
  }): Promise<void> {
    handleResponse(
      (await getFacade(homey, zoneType, Number(zoneId)).setAta(body))
        .AttributeErrors,
    )
  },
  async setDeviceSettings({
    body,
    homey,
    query,
  }: {
    query?: { driverId: string }
    body: Settings
    homey: Homey
  }): Promise<void> {
    await Promise.all(
      (homey.app as MELCloudApp)
        .getDevices({ driverId: query?.driverId })
        .map(async (device) => {
          const changedKeys = Object.keys(body).filter(
            (changedKey) => body[changedKey] !== device.getSetting(changedKey),
          )
          if (changedKeys.length) {
            await device.setSettings(
              Object.fromEntries(changedKeys.map((key) => [key, body[key]])),
            )
            await device.onSettings({
              changedKeys,
              newSettings: device.getSettings() as Settings,
            })
          }
        }),
    )
  },
  async setFrostProtectionSettings({
    body,
    homey,
    params: { zoneId, zoneType },
  }: {
    body: FrostProtectionSettings
    homey: Homey
    params: { zoneId: string; zoneType: keyof typeof modelClass }
  }): Promise<void> {
    handleResponse(
      (
        await getFacade(homey, zoneType, Number(zoneId)).setFrostProtection(
          body,
        )
      ).AttributeErrors,
    )
  },
  async setHolidayModeSettings({
    body: { enabled, from, to },
    homey,
    params: { zoneId, zoneType },
  }: {
    body: HolidayModeSettings
    homey: Homey
    params: { zoneId: string; zoneType: keyof typeof modelClass }
  }): Promise<void> {
    try {
      handleResponse(
        (
          await getFacade(homey, zoneType, Number(zoneId)).setHolidayMode({
            enabled,
            from,
            to,
          })
        ).AttributeErrors,
      )
    } catch (error) {
      throw (
          error instanceof Error &&
            error.message === 'Select either end date or days'
        ) ?
          new Error(homey.__('settings.buildings.holiday_mode.date_missing'))
        : error
    }
  },
}
