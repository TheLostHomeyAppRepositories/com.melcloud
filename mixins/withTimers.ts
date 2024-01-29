import {
  DateTime,
  Duration,
  type DurationLike,
  type DurationLikeObject,
} from 'luxon'
import type { HomeyClass } from '../types'

interface BaseTimerOptions {
  readonly actionType: string
  readonly units: readonly (keyof DurationLikeObject)[]
}

interface TimerOptions extends BaseTimerOptions {
  readonly timerWords: readonly [string, string]
  readonly timerType: 'setInterval' | 'setTimeout'
}

type Timer = (
  callback: () => Promise<void>,
  interval: DurationLike,
  options: BaseTimerOptions,
) => NodeJS.Timeout

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TimerClass = new (...args: any[]) => {
  setInterval: Timer
  setTimeout: Timer
}

// eslint-disable-next-line max-lines-per-function
const withTimers = <T extends HomeyClass>(base: T): T & TimerClass =>
  class extends base {
    public setInterval(
      callback: () => Promise<void>,
      interval: DurationLike,
      options: BaseTimerOptions,
    ): NodeJS.Timeout {
      const { actionType, units } = options
      return this.setTimer(callback, interval, {
        actionType,
        timerType: 'setInterval',
        timerWords: ['every', 'starting'],
        units,
      })
    }

    public setTimeout(
      callback: () => Promise<void>,
      interval: DurationLike,
      options: BaseTimerOptions,
    ): NodeJS.Timeout {
      const { actionType, units } = options
      return this.setTimer(callback, interval, {
        actionType,
        timerType: 'setTimeout',
        timerWords: ['in', 'on'],
        units,
      })
    }

    private setTimer(
      callback: () => Promise<void>,
      interval: DurationLike,
      options: TimerOptions,
    ): NodeJS.Timeout {
      const { actionType, timerWords, timerType, units } = options
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
          .toLocaleString(DateTime.DATETIME_HUGE_WITH_SECONDS),
      )
      return this.homey[timerType](callback, duration.as('milliseconds'))
    }
  }

export default withTimers
