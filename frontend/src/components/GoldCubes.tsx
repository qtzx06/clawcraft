import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

const NB_OBJECTS = 600

interface Cube {
  o3d: THREE.Object3D
  velocity: THREE.Vector3
  shuffle: () => void
  move: (dest: THREE.Vector3) => void
}

export default function GoldCubes() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const attraction = 0.03
    const velocityLimit = 1.2
    const destination = new THREE.Vector3(0, 0, 0)
    const mouse = new THREE.Vector2()
    const mousePosition = new THREE.Vector3()
    const mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    const raycaster = new THREE.Raycaster()
    let mouseOver = false

    // renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.4
    el.appendChild(renderer.domElement)

    // scene
    const scene = new THREE.Scene()

    // generate environment map for reflections
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = new THREE.Scene()
    envScene.background = new THREE.Color(0x111111)
    const envGeo = new THREE.PlaneGeometry(200, 200)
    const envMat1 = new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide })
    const envMat2 = new THREE.MeshBasicMaterial({ color: 0xc8a84e, side: THREE.DoubleSide })
    const envMat3 = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    const p1 = new THREE.Mesh(envGeo, envMat1)
    p1.position.set(0, 100, 0); p1.rotation.x = Math.PI / 2
    envScene.add(p1)
    const p2 = new THREE.Mesh(envGeo, envMat2)
    p2.position.set(0, -100, 0); p2.rotation.x = -Math.PI / 2
    envScene.add(p2)
    const p3 = new THREE.Mesh(envGeo, envMat3)
    p3.position.set(0, 0, -100)
    envScene.add(p3)
    const p4 = new THREE.Mesh(envGeo, envMat1)
    p4.position.set(100, 0, 0); p4.rotation.y = -Math.PI / 2
    envScene.add(p4)
    const envMap = pmrem.fromScene(envScene, 0.04).texture
    scene.environment = envMap
    envScene.clear()
    pmrem.dispose()
    envGeo.dispose()
    envMat1.dispose()
    envMat2.dispose()
    envMat3.dispose()

    // lights
    scene.add(new THREE.AmbientLight(0xc8a84e, 1.0))
    const keyLight = new THREE.PointLight(0xffd700, 2.0, 800)
    keyLight.position.set(50, 30, 100)
    scene.add(keyLight)
    const fillLight = new THREE.PointLight(0xc8a84e, 1.0, 600)
    fillLight.position.set(-30, -60, 50)
    scene.add(fillLight)
    const mouseLight = new THREE.PointLight(0xffd700, 2.5, 400)
    mouseLight.position.set(0, 0, 80)
    scene.add(mouseLight)

    // camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.z = 150

    // shiny gold material
    const geo = new THREE.BoxGeometry(10, 10, 10)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.18,
      metalness: 1.0,
      emissive: 0x8B6914,
      emissiveIntensity: 0.3,
      envMapIntensity: 2.0,
    })

    function rnd(max: number, negative?: boolean) {
      return negative ? Math.random() * 2 * max - max : Math.random() * max
    }
    function limit(n: number, min: number, max: number) {
      return Math.min(Math.max(n, min), max)
    }

    // create cubes
    const objects: Cube[] = []
    for (let i = 0; i < NB_OBJECTS; i++) {
      const velocity = new THREE.Vector3(rnd(1, true), rnd(1, true), rnd(1, true))
      const o3d = new THREE.Object3D()
      o3d.add(new THREE.Mesh(geo, mat))
      scene.add(o3d)

      const cube: Cube = {
        o3d,
        velocity,
        shuffle() {
          this.velocity.set(rnd(1, true), rnd(1, true), rnd(1, true))
          const p = new THREE.Vector3(rnd(1, true), rnd(1, true), rnd(1, true)).normalize().multiplyScalar(150)
          this.o3d.position.copy(p)
          const s = rnd(0.4) + 0.1
          this.o3d.scale.set(s, s, s)
        },
        move(dest: THREE.Vector3) {
          const dv = dest.clone().sub(this.o3d.position).normalize()
          this.velocity.x += attraction * dv.x
          this.velocity.y += attraction * dv.y
          this.velocity.z += attraction * dv.z
          this.velocity.x = limit(this.velocity.x, -velocityLimit, velocityLimit)
          this.velocity.y = limit(this.velocity.y, -velocityLimit, velocityLimit)
          this.velocity.z = limit(this.velocity.z, -velocityLimit, velocityLimit)
          this.o3d.lookAt(this.o3d.position.clone().add(this.velocity))
          this.o3d.position.add(this.velocity)
        },
      }
      cube.shuffle()
      objects.push(cube)
    }

    // bloom
    const composer = new EffectComposer(renderer)
    const renderPass = new RenderPass(scene, camera)
    renderPass.clearAlpha = 0
    composer.addPass(renderPass)
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.0,   // strength
      0.4,   // radius
      0.2    // threshold
    )
    composer.addPass(bloom)

    // animation
    let raf: number
    function animate() {
      raf = requestAnimationFrame(animate)
      const dest = mouseOver ? mousePosition : destination
      for (const obj of objects) obj.move(dest)
      composer.render()
    }
    animate()

    // mouse events
    function onMouseMove(e: MouseEvent) {
      const v = new THREE.Vector3()
      camera.getWorldDirection(v).normalize()
      mousePlane.normal.copy(v)

      mouseOver = true
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1

      raycaster.setFromCamera(mouse, camera)
      raycaster.ray.intersectPlane(mousePlane, mousePosition)
      mouseLight.position.copy(mousePosition)
    }
    function onMouseOut() {
      mouseOver = false
      mouseLight.position.set(0, 0, 80)
    }
    function onResize() {
      if (!el) return
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
      composer.setSize(window.innerWidth, window.innerHeight)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseout', onMouseOut)
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseout', onMouseOut)
      window.removeEventListener('resize', onResize)
      composer.dispose()
      renderer.dispose()
      geo.dispose()
      mat.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[50] pointer-events-none"
      style={{ mixBlendMode: 'screen' }}
    />
  )
}
