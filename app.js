// -------------------------------------------------------------
// CONFIGURACIÓN DE LA ESCENA, CÁMARA Y RENDERER
// -------------------------------------------------------------
const canvas = document.querySelector('#webgl');
const loader = document.querySelector('#loader');

const scene = new THREE.Scene();

// Cámara
const camera = new THREE.PerspectiveCamera(
    45, 
    window.innerWidth / window.innerHeight, 
    0.1, 
    100
);
camera.position.z = 5.5;

// Renderer
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// -------------------------------------------------------------
// TEXTURAS Y PRE-CARGA
// -------------------------------------------------------------
const textureLoader = new THREE.TextureLoader();
const textures = {};
const imageAspectRatios = {
    art1: 1.0,
    art2: 1.0
};
const imagesToLoad = {
    art1: 'ComfyUI_00002_.png',
    art2: 'ComfyUI_00003_.png'
};

let loadedCount = 0;
const totalImages = Object.keys(imagesToLoad).length;

// Carga las imágenes de forma asíncrona
function loadTexture(key, url) {
    textureLoader.load(
        url,
        (texture) => {
            texture.generateMipmaps = false;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            textures[key] = texture;
            
            // Guardar el ratio real de la imagen cargada
            if (texture.image) {
                imageAspectRatios[key] = texture.image.width / texture.image.height;
            }
            
            checkAllLoaded();
        },
        undefined,
        (error) => {
            console.error(`Error cargando textura ${url}:`, error);
            // Fallback: crea una textura degradada de color si la imagen falla
            const canvasFallback = document.createElement('canvas');
            canvasFallback.width = 512;
            canvasFallback.height = 512;
            const ctx = canvasFallback.getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, 512, 512);
            grad.addColorStop(0, key === 'art1' ? '#1f4068' : '#e43f5a');
            grad.addColorStop(1, '#162447');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 512, 512);
            ctx.fillStyle = '#ffffff';
            ctx.font = '30px serif';
            ctx.fillText(key.toUpperCase(), 150, 250);
            
            const fallbackTexture = new THREE.CanvasTexture(canvasFallback);
            textures[key] = fallbackTexture;
            checkAllLoaded();
        }
    );
}

// Inicia carga de las imágenes
for (const [key, url] of Object.entries(imagesToLoad)) {
    loadTexture(key, url);
}

function checkAllLoaded() {
    loadedCount++;
    if (loadedCount === totalImages) {
        initScene();
        setTimeout(() => {
            if (loader) loader.classList.add('fade-out');
        }, 500);
    }
}

// -------------------------------------------------------------
// DEFINICIÓN DE LOS SHADERS PERSONALIZADOS (GLSL)
// -------------------------------------------------------------
const vertexShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    uniform float uTime;
    uniform float uProgress;

    void main() {
        vUv = uv;
        vec3 pos = position;
        
        // Oscilación sutil constante (efecto flotante tipo papel)
        float waveX = sin(pos.y * 2.0 + uTime * 0.6) * 0.05;
        float waveY = cos(pos.x * 2.0 + uTime * 0.6) * 0.05;
        pos.z += waveX + waveY;
        
        // Deformación física 3D en el eje Z al hacer hover (abombamiento)
        float bulge = sin(uv.x * 3.14159) * sin(uv.y * 3.14159) * uProgress * 0.4;
        pos.z += bulge;

        vPosition = pos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const fragmentShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    uniform sampler2D uTexture;
    uniform float uTime;
    uniform float uProgress;
    uniform vec2 uMouse;
    
    // Uniforms de la estela del cursor (Mouse Trail)
    uniform vec2 uTrailPoints[10];
    uniform float uTrailIntensities[10];

    void main() {
        vec2 uv = vUv;
        
        // Ondas fluidas ambientales sutiles
        vec2 ambientWave = vec2(
            sin(uv.y * 8.0 + uTime * 0.4) * 0.003,
            cos(uv.x * 8.0 + uTime * 0.4) * 0.003
        );
        
        // 1. Acumulación de distorsiones de la ESTELA (Mouse Trail)
        vec2 trailDistort = vec2(0.0);
        for (int i = 0; i < 10; i++) {
            float intensity = uTrailIntensities[i];
            if (intensity > 0.0) {
                vec2 p = uTrailPoints[i];
                float d = distance(uv, p);
                
                // Ripple local para este punto de la estela
                float rip = sin(d * 22.0 - uTime * 5.0) * 0.04 * intensity;
                rip *= exp(-d * 4.0); // Atenuación por distancia
                
                // Sumamos la deformación
                trailDistort += (uv - p) * rip;
            }
        }
        
        // 2. Onda expansiva concéntrica desde el cursor inmediato (Hover principal)
        float mainDist = distance(uv, uMouse);
        float mainRipple = sin(mainDist * 25.0 - uTime * 4.0) * 0.05 * uProgress;
        mainRipple *= exp(-mainDist * 3.5);
        vec2 mainDistort = (uv - uMouse) * mainRipple;
        
        // 3. Turbulencia líquida global durante la deformación
        vec2 liquidDistort = vec2(
            sin(uv.y * 12.0 + uTime * 2.0) * 0.02,
            cos(uv.x * 12.0 + uTime * 2.0) * 0.02
        ) * uProgress;
        
        // UVs finales distorsionadas acumulando el movimiento
        vec2 finalUv = uv + ambientWave + liquidDistort + mainDistort + trailDistort;
        finalUv = clamp(finalUv, 0.0, 1.0);

        // Obtener el color directamente sin alteración RGB
        vec4 color = texture2D(uTexture, finalUv);
        
        // Sutil viñeta oscura para enfocar el centro
        float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
        vignette = clamp(pow(vignette * 16.0, 0.25), 0.0, 1.0);
        
        gl_FragColor = color * mix(0.7, 1.0, vignette);
    }
`;

// -------------------------------------------------------------
// CREACIÓN DE OBJETOS 3D
// -------------------------------------------------------------
let geometry, material, mesh;
let currentTextureKey = 'art1';

// Parámetros de la estela (Trail)
const maxTrail = 10;
const trail = []; // Contenedor de puntos de la estela

// Uniforms del Shader
const uniforms = {
    uTexture: { value: null },
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uTrailPoints: { value: new Float32Array(maxTrail * 2) },
    uTrailIntensities: { value: new Float32Array(maxTrail) }
};

function initScene() {
    // Geometría plana subdividida
    geometry = new THREE.PlaneGeometry(2.6, 3.2, 64, 64);
    
    // ShaderMaterial
    uniforms.uTexture.value = textures[currentTextureKey];
    material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: uniforms,
        side: THREE.DoubleSide
    });
    
    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    
    // Ajustar escala inicial
    adjustMeshScale();
}

// -------------------------------------------------------------
// ESCALADO FULL WIDTH DINÁMICO (MATEMÁTICA FRUSTUM)
// -------------------------------------------------------------
function adjustMeshScale() {
    if (!mesh) return;
    
    // Calcular tamaño visible en la pantalla basándonos en la distancia de la cámara
    const distance = camera.position.z - mesh.position.z;
    const vFov = (camera.fov * Math.PI) / 180;
    const screenHeight = 2 * Math.tan(vFov / 2) * distance;
    const screenWidth = screenHeight * (window.innerWidth / window.innerHeight);
    
    // Ratio de aspecto de la textura actual
    const activeRatio = imageAspectRatios[currentTextureKey] || (2.6 / 3.2);
    
    // Asignar el ancho visible completo de la pantalla
    const targetWidth = screenWidth;
    // Calcular el alto manteniendo la proporción original de la imagen
    const targetHeight = screenWidth / activeRatio;
    
    // Escalar la malla con respecto a las dimensiones base de la geometría (2.6 x 3.2)
    const scaleX = targetWidth / 2.6;
    const scaleY = targetHeight / 3.2;
    
    mesh.scale.set(scaleX, scaleY, 1);
}

// -------------------------------------------------------------
// RAYCASTING Y EVENTOS DE MOUSE
// -------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const mouseTarget = new THREE.Vector2(0.5, 0.5); // Posición suavizada
const viewMouse = new THREE.Vector2(); // Para parallax de cámara

// Estado de la animación de deformación
let isHovered = false;
let isAnimatingDistortion = false;
let distortionStartTime = 0;
const distortionDuration = 2000; // 2 segundos en milisegundos

// Detectar movimiento en ventana
window.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    viewMouse.x = mouse.x;
    viewMouse.y = mouse.y;
    
    // Capturar punto de estela si el puntero está interactuando
    captureTrailPoint();
});

// Soporte táctil móvil
window.addEventListener('touchmove', (event) => {
    if (event.touches.length > 0) {
        const touch = event.touches[0];
        mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        viewMouse.x = mouse.x;
        viewMouse.y = mouse.y;
        
        captureTrailPoint();
    }
}, { passive: true });

// Capturador de puntos para la estela (Trail)
function captureTrailPoint() {
    if (!mesh) return;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(mesh);
    
    if (intersects.length > 0) {
        const uv = intersects[0].uv;
        
        // Evitar agregar puntos demasiado apilados que saturen el shader
        let shouldAdd = false;
        if (trail.length === 0) {
            shouldAdd = true;
        } else {
            const lastPoint = trail[trail.length - 1];
            // Distancia euclidiana entre las coordenadas UV
            const dist = uv.distanceTo(lastPoint.uv);
            if (dist > 0.015) { // Distancia mínima del 1.5% del tamaño de textura
                shouldAdd = true;
            }
        }
        
        if (shouldAdd) {
            trail.push({
                uv: uv.clone(),
                intensity: 1.0,
                age: 0.0
            });
            
            // Limitar la estela al tamaño máximo permitido
            if (trail.length > maxTrail) {
                trail.shift();
            }
        }
    }
}

// -------------------------------------------------------------
// REPRODUCTOR DE AUDIO INTERACTIVO (POOL DE AUDIOS PRECARGADOS)
// -------------------------------------------------------------
const audioPoolSize = 5;
const audioPool = [];

// Precargar e inicializar el pool de audios inmediatamente al iniciar el script
for (let i = 0; i < audioPoolSize; i++) {
    const snd = new Audio('ballroom-vogue-crash_103bpm_F_minor.wav');
    snd.preload = 'auto';
    snd.volume = 0.5; // Nivel de volumen óptimo y elegante
    snd.load();       // Forzar al navegador a iniciar la descarga HTTP de inmediato
    audioPool.push(snd);
}

let poolIndex = 0;

function playClickSound() {
    // Ciclar a través del pool de audios para permitir múltiples clicks e impactos superpuestos
    const snd = audioPool[poolIndex];
    snd.currentTime = 0;
    snd.play().catch((error) => {
        console.warn("La reproducción del sonido interactivo fue bloqueada por el navegador:", error);
    });
    poolIndex = (poolIndex + 1) % audioPoolSize;
}

// -------------------------------------------------------------
// SISTEMA DE PARTÍCULAS DE POLVO ROSADO/DORADO
// -------------------------------------------------------------
const particleGroups = [];

// Generador programático de textura circular difuminada
function createCircleTexture() {
    const canvasPart = document.createElement('canvas');
    canvasPart.width = 16;
    canvasPart.height = 16;
    const ctx = canvasPart.getContext('2d');
    
    const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 16);
    
    return new THREE.CanvasTexture(canvasPart);
}

const circleTexture = createCircleTexture();

// Creador del desprendimiento de partículas
function spawnParticles(position) {
    const count = 90; 
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    const colors = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
        const spread = 0.05;
        positions[i * 3] = position.x + (Math.random() - 0.5) * spread;
        positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * spread;
        positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * spread;
        
        const angle = Math.random() * Math.PI * 2;
        const radialSpeed = 0.3 + Math.random() * 0.7;
        const vx = Math.cos(angle) * radialSpeed * 0.5;
        const vy = (Math.random() * 0.7 + 0.3); // Impulso ascendente leve inicial
        const vz = (Math.random() - 0.5) * 0.3;
        
        velocities.push({ x: vx, y: vy, z: vz });
        
        // Asignar colores: Rosa pastel, Magenta profundo, Oro champagne
        const rand = Math.random();
        if (rand < 0.7) {
            // Rosa Pastel
            colors[i * 3] = 0.95 + Math.random() * 0.05;     
            colors[i * 3 + 1] = 0.45 + Math.random() * 0.15; 
            colors[i * 3 + 2] = 0.65 + Math.random() * 0.15; 
        } else if (rand < 0.9) {
            // Rosa Magenta
            colors[i * 3] = 0.9 + Math.random() * 0.1;       
            colors[i * 3 + 1] = 0.18 + Math.random() * 0.15; 
            colors[i * 3 + 2] = 0.45 + Math.random() * 0.15; 
        } else {
            // Oro Champagne
            colors[i * 3] = 0.95 + Math.random() * 0.05;     
            colors[i * 3 + 1] = 0.8 + Math.random() * 0.1;   
            colors[i * 3 + 2] = 0.48 + Math.random() * 0.15; 
        }
    }
    
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const mat = new THREE.PointsMaterial({
        size: 0.07,
        map: circleTexture,
        vertexColors: true,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    const points = new THREE.Points(geom, mat);
    scene.add(points);
    
    particleGroups.push({
        points: points,
        geometry: geom,
        material: mat,
        positions: positions,
        velocities: velocities,
        startTime: performance.now(),
        duration: 2200 
    });
}

// -------------------------------------------------------------
// CAMBIO DE OBRA (INTERACTIVIDAD POR CLIC)
// -------------------------------------------------------------
function switchArtwork(textureKey) {
    if (textureKey === currentTextureKey) return;
    
    // Transición artística épica:
    isAnimatingDistortion = true;
    distortionStartTime = performance.now();
    
    // Cambiar la textura a los 300ms (pico de la deformación)
    setTimeout(() => {
        currentTextureKey = textureKey;
        uniforms.uTexture.value = textures[textureKey];
        adjustMeshScale();
    }, 300);
}

// Escuchar clics sobre el lienzo flotante
window.addEventListener('click', () => {
    if (!mesh) return;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(mesh);
    
    if (intersects.length > 0) {
        const nextTextureKey = currentTextureKey === 'art1' ? 'art2' : 'art1';
        switchArtwork(nextTextureKey);
        
        // Spawn de partículas en la coordenada 3D exacta
        spawnParticles(intersects[0].point);
        
        // Reproducir el sonido interactivo de impacto desde el pool
        playClickSound();
    }
});

// -------------------------------------------------------------
// BUCLE DE ANIMACIÓN PRINCIPAL (TICK)
// -------------------------------------------------------------
const clock = new THREE.Clock();
let lastTime = performance.now();

const tick = () => {
    const elapsedTime = clock.getElapsedTime();
    const nowTime = performance.now();
    
    // Calcular delta de tiempo seguro e independiente de la tasa de refresco
    const deltaTime = Math.min((nowTime - lastTime) / 1000, 0.1);
    lastTime = nowTime;
    
    // Actualizar tiempo del shader
    uniforms.uTime.value = elapsedTime;
    
    // 1. Envejecer y desvanecer los puntos de la estela (Mouse Trail)
    for (let i = trail.length - 1; i >= 0; i--) {
        const pt = trail[i];
        pt.age += deltaTime;
        
        // Desvanecimiento suave e individual sobre 1.0 segundo
        pt.intensity = Math.pow(Math.max(0, 1.0 - pt.age / 1.0), 2.0);
        
        if (pt.age >= 1.0) {
            trail.splice(i, 1);
        }
    }
    
    // Pasar los valores de la estela a los uniforms
    const pointsArray = [];
    const intensitiesArray = [];
    for (let i = 0; i < maxTrail; i++) {
        if (i < trail.length) {
            pointsArray.push(trail[i].uv.x, trail[i].uv.y);
            intensitiesArray.push(trail[i].intensity);
        } else {
            pointsArray.push(0.5, 0.5);
            intensitiesArray.push(0.0);
        }
    }
    uniforms.uTrailPoints.value = pointsArray;
    uniforms.uTrailIntensities.value = intensitiesArray;
    
    // 2. Simular y actualizar partículas activas
    for (let g = particleGroups.length - 1; g >= 0; g--) {
        const group = particleGroups[g];
        const age = nowTime - group.startTime;
        const progress = age / group.duration;
        
        if (progress >= 1.0) {
            scene.remove(group.points);
            group.geometry.dispose();
            group.material.dispose();
            particleGroups.splice(g, 1);
        } else {
            const posAttr = group.geometry.attributes.position;
            const posArray = posAttr.array;
            
            for (let i = 0; i < group.velocities.length; i++) {
                const vel = group.velocities[i];
                vel.y -= 1.6 * deltaTime; // Gravedad
                vel.x *= (1.0 - 0.4 * deltaTime); // Fricción
                vel.z *= (1.0 - 0.4 * deltaTime);
                
                posArray[i * 3] += vel.x * deltaTime;
                posArray[i * 3 + 1] += vel.y * deltaTime;
                posArray[i * 3 + 2] += vel.z * deltaTime;
            }
            
            posAttr.needsUpdate = true;
            group.material.opacity = Math.pow(1.0 - progress, 1.6);
            group.material.size = 0.07 * (1.0 - progress * 0.4);
        }
    }
    
    if (mesh) {
        // Flotación espacial sutil
        mesh.position.y = Math.sin(elapsedTime * 0.8) * 0.08;
        mesh.position.x = Math.cos(elapsedTime * 0.5) * 0.05;
        
        // Parallax de inercia de la malla
        const targetRotX = viewMouse.y * 0.15;
        const targetRotY = viewMouse.x * 0.15;
        
        mesh.rotation.x += (targetRotX - mesh.rotation.x) * 0.05;
        mesh.rotation.y += (targetRotY - mesh.rotation.y) * 0.05;
        mesh.rotation.z += (Math.sin(elapsedTime * 0.3) * 0.02 - mesh.rotation.z) * 0.02;
        
        // Raycaster para detectar HOVER
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(mesh);
        
        if (intersects.length > 0) {
            const intersectPoint = intersects[0];
            mouseTarget.copy(intersectPoint.uv);
            
            if (!isHovered) {
                isHovered = true;
                if (!isAnimatingDistortion) {
                    isAnimatingDistortion = true;
                    distortionStartTime = performance.now();
                }
            }
        } else {
            isHovered = false;
        }
        
        // Suavizado del puntero enviado al shader
        uniforms.uMouse.value.x += (mouseTarget.x - uniforms.uMouse.value.x) * 0.15;
        uniforms.uMouse.value.y += (mouseTarget.y - uniforms.uMouse.value.y) * 0.15;
    }
    
    // Decaimiento de la deformación del hover principal (Curva de 2 segundos)
    if (isAnimatingDistortion) {
        const elapsedMs = nowTime - distortionStartTime;
        const elapsedSec = elapsedMs / 1000;
        
        if (elapsedSec < 2.0) {
            const rampUp = 0.3; 
            let progress = 0;
            
            if (elapsedSec < rampUp) {
                progress = elapsedSec / rampUp;
            } else {
                const t = (elapsedSec - rampUp) / (2.0 - rampUp);
                progress = Math.pow(1.0 - t, 2.5); 
            }
            
            uniforms.uProgress.value = progress;
        } else {
            isAnimatingDistortion = false;
            uniforms.uProgress.value = 0.0;
        }
    }
    
    // Parallax de la cámara
    camera.position.x += (viewMouse.x * 0.3 - camera.position.x) * 0.03;
    camera.position.y += (viewMouse.y * 0.3 - camera.position.y) * 0.03;
    camera.lookAt(scene.position);
    
    // Render
    renderer.render(scene, camera);
    
    // Siguiente frame
    window.requestAnimationFrame(tick);
};

// Iniciar animación
tick();

// -------------------------------------------------------------
// EVENTOS DE RESIZE
// -------------------------------------------------------------
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    adjustMeshScale();
});
