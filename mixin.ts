// eslint-disable-next-line import/no-extraneous-dependencies
import { Device } from 'homey'
import axios from 'axios'
import type {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'
import { DateTime, Duration } from 'luxon'
import type { DurationLikeObject } from 'luxon'

type TimerFunction = (
  callback: () => Promise<void>,
  duration: number
) => NodeJS.Timeout

type TimerClass = new (...args: any[]) => {
  error(...errorArgs: any[]): void
  log(...logArgs: any[]): void
  homey: {
    setInterval: TimerFunction
    setTimeout: TimerFunction
    settings: {
      get(key: string): string | null
    }
  }
}

export default function WithCustomLogging<T extends TimerClass>(Base: T) {
  return class extends Base {
    axios: AxiosInstance

    constructor(...args: any[]) {
      super(...args)
      this.axios = axios.create()
      this.setupAxiosInterceptors()
    }

    setupAxiosInterceptors() {
      this.axios.interceptors.request.use(
        (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig =>
          this.handleRequest(config),
        (error: AxiosError): Promise<AxiosError> =>
          this.handleError('request', error)
      )
      this.axios.interceptors.response.use(
        (response: AxiosResponse): AxiosResponse =>
          this.handleResponse(response),
        (error: AxiosError): Promise<AxiosError> =>
          this.handleError('response', error)
      )
    }

    handleRequest(
      config: InternalAxiosRequestConfig
    ): InternalAxiosRequestConfig {
      const updatedConfig: InternalAxiosRequestConfig = { ...config }
      updatedConfig.headers['X-MitsContextKey'] =
        this.homey.settings.get('ContextKey') ?? ''
      this.log(
        'Sending request:',
        updatedConfig.url,
        updatedConfig.method === 'post' ? updatedConfig.data : ''
      )
      return updatedConfig
    }

    handleResponse(response: AxiosResponse): AxiosResponse {
      this.log('Received response:', response.config.url, response.data)
      return response
    }

    handleError(
      type: 'request' | 'response',
      error: AxiosError
    ): Promise<AxiosError> {
      this.error(
        `Error in ${type}:`,
        error.config?.url,
        error.response ? error.response.data : error
      )
      return Promise.reject(error)
    }

    customLog(method: 'log' | 'error', ...args: any[]): void {
      if (this instanceof Device) {
        super[method](this.getName(), '-', ...args)
      } else {
        super[method](...args)
      }
    }

    error(...args: any[]): void {
      this.customLog('error', ...args)
    }

    log(...args: any[]): void {
      this.customLog('log', ...args)
    }

    setTimer(
      actionType: string,
      timerWords: [string, string],
      timerType: 'setInterval' | 'setTimeout',
      callback: () => Promise<void>,
      interval: number | DurationLikeObject,
      ...units: (keyof DurationLikeObject)[]
    ): NodeJS.Timeout {
      const duration: Duration = Duration.fromDurationLike(interval)
      this.log(
        `${actionType.charAt(0).toUpperCase()}${actionType
          .slice(1)
          .toLowerCase()}`,
        'will run',
        timerWords[0],
        duration.shiftTo(...units).toHuman(),
        timerWords[1],
        DateTime.now()
          .plus(duration)
          .toLocaleString(DateTime.DATETIME_HUGE_WITH_SECONDS)
      )
      return this.homey[timerType](callback, Number(duration))
    }

    setInterval(
      actionType: string,
      callback: () => Promise<void>,
      interval: number | DurationLikeObject,
      ...units: (keyof DurationLikeObject)[]
    ): NodeJS.Timeout {
      return this.setTimer(
        actionType,
        ['every', 'starting'],
        'setInterval',
        callback,
        interval,
        ...units
      )
    }

    setTimeout(
      actionType: string,
      callback: () => Promise<void>,
      interval: number | DurationLikeObject,
      ...units: (keyof DurationLikeObject)[]
    ): NodeJS.Timeout {
      return this.setTimer(
        actionType,
        ['in', 'on'],
        'setTimeout',
        callback,
        interval,
        ...units
      )
    }
  }
}
