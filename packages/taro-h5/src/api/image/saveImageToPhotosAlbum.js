import { base64ToBlob } from '../utils/index'

/**
 * 保存base64图片到本地
 * @param {*} filePath 图片base64
 * @param {*} fileName 图片名称
 * @param {*} success 成功回调
 */

const saveImageToPhotosAlbum = ({ filePath, fileName, success }) => {
  const aLink = document.createElement('a')
  const blob = base64ToBlob(filePath)
  const evt = document.createEvent('HTMLEvents')
  evt.initEvent('click', true, true) // initEvent 不加后两个参数在FF下会报错  事件类型，是否冒泡，是否阻止浏览器的默认行为
  aLink.download = fileName || 'picture.jpg'
  aLink.href = URL.createObjectURL(blob)
  aLink.click()
  success && success()
  return Promise.resolve()
}
export default saveImageToPhotosAlbum
