// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Component, h, Host, Event, Prop, EventEmitter } from '@stencil/core'
// import { Component, h, Prop, State, ComponentInterface, Event, EventEmitter, Listen, Element, Host } from '@stencil/core'
@Component({
  tag: 'taro-camera-core'
})
export class Camera {
  // frameSize = 'medium'
  // mode = 'normal'
  // devicePosition = 'back'
  // resolution = 'high'
  // flash = 'off'
  @Prop() frameSize: string

  @Event({
    eventName: 'initdone'
  })
  onSubmit: EventEmitter

  componentDidLoad() {
    this.onSubmit.emit()
  }

  render() {
    return <Host>Camera</Host>
  }
}
