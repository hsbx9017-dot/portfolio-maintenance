"use client";

/**
 * 全站 3D 空间 —— 星系
 * ---------------------------------------------------------------------------
 * 页面上每一个区块 = 星系里的一颗行星，8 颗均分一圈（每 45° 一颗），
 * 中央是一颗恒星。默认视角站在星系外侧俯视，8 颗行星连同名字**一眼全在画面里**；
 * 点某颗行星（或它的名牌）→ 镜头飞过去，停在那颗行星的解说板前。
 *
 *   启程星 → 作品星 → 实践星 → 证书星 → 关于星 → 经历星 → 技能星 → 联系星
 *
 * 相机立足点为什么必须在系统外面
 * ---------------------------------------------------------------------------
 * 早先的门厅版本把相机放在厅心、朝外看，45° 视角里最多只能同时看到 2~3 扇门 ——
 * 「一眼看到所有星球」这件事在那个立足点上做不到，不是换个模型能解决的。
 * 所以这一版把相机移到系统外侧、俯视 31.5°，整圈星轨才落进画面。
 *
 * 每一颗行星的解说板
 * ---------------------------------------------------------------------------
 * 停靠后，那间房的正文（DOM 里那块 .board）被投影到行星外侧的平面上，1:1 铺在
 * 正前方。投影这一套逻辑是沿用门厅版本的：每帧把锚点的世界坐标投到屏幕，再用
 * 板顶的投影反推 scale，写回 translate3d + scale。正文因此仍然只有一份 ——
 * 字可选中、可点、可被搜索。
 *
 * 一个必须说明的取舍：停靠时板上内容占满画面，那颗行星就在板子正后方
 * （行星半径算过，正好比板子矮一档，不会从板子边缘露出来）。也就是说
 * 「到达」那一刻你看的是内容，不是星球 —— 星球是星图上的主角，飞行途中也看得到。
 * 如果想让行星和板子同框，就得把板子缩到约六成、正文跟着变小，那是另一套取舍。
 *
 * 窄屏 / 系统开启「减少动态效果」/ 不支持 WebGL 时整层退回静态背景，
 * 摘掉 html.spatial-on，区块回到普通文档流，页面照常可读可点、也能滚动。
 * ---------------------------------------------------------------------------
 */

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FaArrowLeft, FaArrowRight, FaRocket } from "react-icons/fa6";

import { registerRoomEnter } from "@/lib/spatial";
import { roomBlurbs } from "@/data";

/* ============================== 星系尺寸表 ============================== */

const SPACE_COLOR = "#04061a";

/** 解说板：DOM 里那块是 1000×600，在空间里高 5.8 个世界单位 */
const BOARD_PX_W = 1000;
const BOARD_PX_H = 600;
const BOARD_H = 5.8;
const BOARD_W = (BOARD_H * BOARD_PX_W) / BOARD_PX_H;

/** 相机视高。解说板中心也放在这个高度，板子和视线齐平 */
const EYE = 2.4;
const BOARD_MID_Y = EYE;

/** 星轨半径：8 颗行星均分一圈 */
const R_ORBIT = 26;
/** 恒星半径 */
const SUN_R = 3.0;

/** 解说板锚点离星系中心的距离 */
const BOARD_R = 30;
/** 停靠时相机离板面的距离。这个距离下 1000×600 正好 1:1 铺满 */
const DOCK_DIST = 10.5;
const DOCK_R = BOARD_R - DOCK_DIST;

/** 星图视角：站在系统外侧俯视。俯角换算成弧度。
    距离取 66 而不是刚好装下：再近的话，正下方那颗最近的行星会被屏幕下边缘切掉。 */
const MAP_DIST = 66;
const MAP_ELEV = 0.55;
const MAP_HORIZ = Math.cos(MAP_ELEV) * MAP_DIST;
const MAP_HEIGHT = Math.sin(MAP_ELEV) * MAP_DIST;

/** 星图的视线落点，压在星系中心**下方**一点 ——
    这样整圈星轨在画面里往上挪，最近那颗行星不会贴到屏幕底边 */
const MAP_LOOK = new THREE.Vector3(0, -2.5, 0);

/** 行星名牌：抬到球心上方多高 */
const PLATE_LIFT = 3.6;

/** 两条飞行时间：图上飞过去，和在两颗行星之间跳 */
const FLY_SECONDS = 2.6;
const HOP_SECONDS = 4.4;

/**
 * 8 颗行星。id 同时是 DOM 里 [data-board="…"] 的值，顺序必须和
 * app/page.tsx 里 8 个区块的顺序一致，否则星名会和板上的正文对不上。
 * accent 也要和 globals.css 里 .board[data-board="…"] 的 --board-accent 保持一致。
 *
 * 半径都压在 1.48~1.74：停靠时行星在相机正前方 6.5 个单位处，这个尺寸下
 * 它在屏幕上比 600px 高的板子矮一档，正好被板子挡住，不会从边缘露出来。
 */
type Room = {
  id: string;
  label: string;
  accent: string;
  angle: number;
};

const ROOMS: Room[] = [
  { id: "hero", label: "启程星", accent: "#ffcf00" },
  { id: "projects", label: "作品星", accent: "#2f7ff0" },
  { id: "approach", label: "实践星", accent: "#ff8a00" },
  { id: "certs", label: "证书星", accent: "#00a3da" },
  { id: "about", label: "关于星", accent: "#b0e01a" },
  { id: "experience", label: "经历星", accent: "#e5007d" },
  { id: "skills", label: "技能星", accent: "#25a745" },
  { id: "contact", label: "联系星", accent: "#e3000b" },
].map((room, i) => ({ ...room, angle: (i * Math.PI * 2) / 8 }));

/** 每颗行星的体型：半径、是否带星环、自转快慢 */
const SHAPES = [
  { r: 1.6, ring: false, spin: 0.1 },
  { r: 1.74, ring: true, spin: 0.16 },
  { r: 1.5, ring: false, spin: 0.22 },
  { r: 1.62, ring: false, spin: 0.13 },
  { r: 1.56, ring: true, spin: 0.19 },
  { r: 1.7, ring: false, spin: 0.11 },
  { r: 1.48, ring: false, spin: 0.24 },
  { r: 1.66, ring: false, spin: 0.15 },
];

const roomIndex = (id: string) => ROOMS.findIndex((r) => r.id === id);

/** 三个常用位置，都是纯函数，随取随算 */
const dirOf = (i: number) =>
  new THREE.Vector3(Math.sin(ROOMS[i].angle), 0, Math.cos(ROOMS[i].angle));
const planetPos = (i: number) => dirOf(i).multiplyScalar(R_ORBIT);
/** 行星正上方挂着解说板，停靠时相机把它摆到画面正中 */
const boardAnchor = (i: number) =>
  dirOf(i).multiplyScalar(BOARD_R).setY(BOARD_MID_Y);
/** 停靠点：沿这颗行星的方位往外，比板面近 10.5 个单位 */
const dockPos = (i: number) => dirOf(i).multiplyScalar(DOCK_R).setY(EYE);
/** 星图视角的位置，由方位角决定 */
const mapPos = (azimuth: number) =>
  new THREE.Vector3(
    Math.sin(azimuth) * MAP_HORIZ,
    MAP_HEIGHT,
    Math.cos(azimuth) * MAP_HORIZ
  );

/** 缓动：两头慢中间快，用来插值飞行路径 */
const ease = (x: number) => x * x * (3 - 2 * x);

/** 镜头这一帧的状态 */
type View = {
  /** 正在前往哪颗行星；-1 表示停在星图上 */
  target: number;
  /** 0 = 刚出发，1 = 已抵达 */
  progress: number;
  /** 星图的方位角，滚轮改变它 */
  azimuth: number;
};

/** 一次飞行的路径。via 为空就是直飞，有 via 就从星图上方绕一下 */
type Flight = {
  active: boolean;
  t: number;
  dur: number;
  fromP: THREE.Vector3;
  toP: THREE.Vector3;
  viaP: THREE.Vector3 | null;
  fromL: THREE.Vector3;
  toL: THREE.Vector3;
  viaL: THREE.Vector3 | null;
  toRoom: number;
};

/* ---------------------------- 基础件 ---------------------------- */

/**
 * 星场：两千多颗星星铺在一层球壳上。
 * 自己写而不是引第三方组件，是因为这点代码很短，而且能直接控制颜色与大小 ——
 * sizeAttenuation 关掉之后，星星在屏幕上就是恒定大小的点，不随距离缩成一片糊。
 */
const Starfield = () => {
  const [pos, col] = useMemo(() => {
    const N = 2400;
    const p = new Float32Array(N * 3);
    const c = new Float32Array(N * 3);
    const tints = ["#ffffff", "#cfe0ff", "#ffe6c0", "#bcd4ff"];
    for (let i = 0; i < N; i++) {
      // 球壳上均匀取点：先取 y 方向余弦，再取经度，才不会在两极堆成一团
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = 95 + Math.random() * 80;
      const s = Math.sqrt(1 - u * u);
      p[i * 3] = Math.sin(theta) * s * r;
      p[i * 3 + 1] = u * r;
      p[i * 3 + 2] = Math.cos(theta) * s * r;

      const tint = new THREE.Color(tints[(Math.random() * tints.length) | 0]);
      const k = 0.45 + Math.random() * 0.55;
      c[i * 3] = tint.r * k;
      c[i * 3 + 1] = tint.g * k;
      c[i * 3 + 2] = tint.b * k;
    }
    return [p, c];
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
        <bufferAttribute attach="attributes-color" args={[col, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={1.5}
        sizeAttenuation={false}
        vertexColors
        transparent
        opacity={0.95}
        depthWrite={false}
      />
    </points>
  );
};

/**
 * 辉光贴图。运行时用 canvas 画一张径向渐变，不占素材体积。
 * 做成模块级单例：9 处辉光共用同一张，不必各建一份。
 *
 * 为什么不用同心球壳堆光晕 —— 那样堆出来是几道可见的环带，像靶子；
 * 径向渐变的 sprite 永远是正对相机的柔和光斑，从任何角度看都对。
 */
let glowTexture: THREE.Texture | null = null;
const getGlowTexture = () => {
  if (glowTexture) return glowTexture;
  if (typeof document === "undefined") return null;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.22, "rgba(255,255,255,0.62)");
  g.addColorStop(0.5, "rgba(255,255,255,0.18)");
  g.addColorStop(0.78, "rgba(255,255,255,0.05)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
};

/**
 * 一团辉光。size 是整个光斑的直径 —— 球体的轮廓只占中间那一小块，
 * 露在外面的部分正好是渐变由亮转透的那一圈，所以看起来是「球在发光」。
 */
const Glow = ({
  color,
  size,
  opacity = 1,
}: {
  color: string;
  size: number;
  opacity?: number;
}) => {
  const tex = getGlowTexture();
  if (!tex) return null;
  return (
    <sprite scale={[size, size, 1]}>
      <spriteMaterial
        map={tex}
        color={color}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
};

/**
 * 行星表面贴图。4 张抽象图案，靠「灰度图案 × 各自本色」着色 ——
 * 8 颗行星因此是 8 种配色，素材却只有 4 张（合计约 330KB）。
 * 模块级缓存：两颗行星用到同一张时，不重复下载、不重复解码。
 */
const TEX_URLS = [
  "/space/planet-bands.jpg",
  "/space/planet-swirl.jpg",
  "/space/planet-cracks.jpg",
  "/space/planet-facets.jpg",
];

const texCache = new Map<string, THREE.Texture>();

const useSpaceTexture = (url: string) => {
  const [tex, setTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    const hit = texCache.get(url);
    if (hit) {
      setTex(hit);
      return;
    }
    let alive = true;
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      /* 只取贴图中间约 40% 采样 ——
         行星在星图上只有 50~60px 见方，整张 512 的纹样会被缩成一片糊，
         放大 2.5 倍之后表面图案才认得出来 */
      t.repeat.set(0.4, 0.4);
      t.offset.set(0.3, 0.3);
      texCache.set(url, t);
      if (alive) setTex(t);
    });
    // 加载失败就不设 state：这颗行星退回纯色球，不拖垮整个场景
    return () => {
      alive = false;
    };
  }, [url]);

  return tex;
};

/** 恒星。本体做得平滑，外面罩一团暖色辉光 */
const Sun = () => (
  <group>
    <mesh>
      <sphereGeometry args={[SUN_R, 40, 40]} />
      <meshStandardMaterial
        color="#fff2c8"
        emissive="#ffcf4d"
        emissiveIntensity={1.15}
        roughness={0.5}
        toneMapped={false}
      />
    </mesh>
    <Glow color="#ffcf6a" size={SUN_R * 8.6} opacity={0.9} />
  </group>
);

/** 星轨：一圈细环，把这 8 颗行星连成一条轨道 */
const OrbitRing = () => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
    <ringGeometry args={[R_ORBIT - 0.06, R_ORBIT + 0.06, 160]} />
    <meshBasicMaterial
      color="#3c4b96"
      transparent
      opacity={0.75}
      side={THREE.DoubleSide}
      depthWrite={false}
    />
  </mesh>
);

/**
 * 一颗行星。
 * 本体是光滑球面 + 一张抽象表面贴图（灰度图案乘上本色着色）。为什么不用
 * 低多边形棱面 —— 棱面上每个三角面只采一个点，贴图会碎成马赛克，看不出图案。
 * 外面罩一团加色辉光做大气；个别带星环。
 */
const Planet = ({
  room,
  index,
  onEnter,
}: {
  room: Room;
  index: number;
  onEnter: (index: number) => void;
}) => {
  const spin = useRef<THREE.Mesh>(null);
  const shape = SHAPES[index];
  /** 贴图按 0/1/2/3 轮着用 —— 8 颗行星两两同图案，靠配色拉开差异 */
  const tex = useSpaceTexture(TEX_URLS[index % TEX_URLS.length]);

  /** 行星本体颜色（贴图还没到位时先顶上）：强调色压暗，压太亮会盖掉恒星照出的明暗 */
  const base = useMemo(
    () =>
      new THREE.Color(room.accent).lerp(new THREE.Color("#151d4a"), 0.62),
    [room.accent]
  );

  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.y += delta * shape.spin;
  });

  return (
    <group
      position={planetPos(index)}
      onClick={(e) => {
        e.stopPropagation();
        onEnter(index);
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <mesh ref={spin} rotation={[0, 0, 0.14]}>
        <sphereGeometry args={[shape.r, 48, 32]} />
        {/* key 是关键：材质是「先无贴图、后补贴图」，而 three 只在材质创建时
            决定要不要编译采样贴图的那套着色器 —— 中途把 map 塞进去，贴图不会生效。
            所以贴图一到位就换一个 key，让这块材质整个重建，map 从创建那一刻就在。 */}
        <meshStandardMaterial
          key={tex ? "textured" : "plain"}
          map={tex ?? undefined}
          color={tex ? room.accent : base}
          /* 同一张贴图再当一次自发光贴图 ——
             行星在星图上只有五十来像素，光靠灯光照，纹样的明暗差会被压平；
             让纹样用自己的本色发光，缩到再小也看得出表面是有东西的 */
          emissive={room.accent}
          emissiveMap={tex ?? undefined}
          emissiveIntensity={tex ? 0.5 : 0.26}
          roughness={0.72}
          metalness={0.06}
        />
      </mesh>

      {/* 大气辉光：一团对本色光斑，比球壳堆出来的柔和得多 */}
      <Glow color={room.accent} size={shape.r * 4.6} opacity={0.66} />

      {shape.ring && (
        <mesh rotation={[-Math.PI / 2 + 0.34, 0, 0.42]}>
          <ringGeometry args={[shape.r * 1.7, shape.r * 2.5, 64]} />
          <meshBasicMaterial
            color={room.accent}
            transparent
            opacity={0.42}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
};

/* ---------------------------- 相机 ---------------------------- */

/**
 * 相机。三种状态都由确定的位置公式算出，没有自由漫游：
 *   · 星图：站在系统外侧，绕方位角公转
 *   · 停靠：沿这颗行星的方位，停在板面前方
 *   · 飞行：在两个位置之间插值，中间可以经过星图上方绕一下
 */
const Rig = ({
  view,
  flight,
}: {
  view: React.MutableRefObject<View>;
  flight: React.MutableRefObject<Flight>;
}) => {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3().copy(MAP_LOOK));
  const want = useRef(new THREE.Vector3().copy(MAP_LOOK));
  const pos = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const v = view.current;
    const f = flight.current;

    if (f.active) {
      const e = ease(Math.min(1, f.t));
      if (f.viaP && f.viaL) {
        /* 两颗行星之间跳：先抬到星图上方，再俯冲到目标。
           直接连直线的话，视线要横跨半个星系甩过去，人会晕。 */
        if (e < 0.5) {
          const k = ease(e / 0.5);
          pos.current.lerpVectors(f.fromP, f.viaP, k);
          want.current.lerpVectors(f.fromL, f.viaL, k);
        } else {
          const k = ease((e - 0.5) / 0.5);
          pos.current.lerpVectors(f.viaP, f.toP, k);
          want.current.lerpVectors(f.viaL, f.toL, k);
        }
      } else {
        pos.current.lerpVectors(f.fromP, f.toP, e);
        want.current.lerpVectors(f.fromL, f.toL, e);
      }
      camera.position.copy(pos.current);
    } else if (v.target < 0) {
      camera.position.copy(mapPos(v.azimuth));
      want.current.copy(MAP_LOOK);
    } else {
      camera.position.copy(dockPos(v.target));
      want.current.copy(boardAnchor(v.target));
    }

    // 视线本身也缓一下，免得飞起来那一刻镜头猛地一甩
    look.current.lerp(want.current, 1 - Math.pow(0.0025, delta));
    camera.lookAt(look.current);
  });

  return null;
};

/* ---------------------------- 解说板的投影 ---------------------------- */

type Stage = {
  el: HTMLElement | null;
  baseLeft: number;
  baseTop: number;
  alpha: number;
};

/**
 * 把 8 块解说板摆到各自行星的外侧。
 * 每帧把锚点的世界坐标投影到屏幕，再用板顶的投影反推 scale，写回
 * translate3d + scale。只有当前这颗行星的板子会淡入 ——
 * 否则会看到 8 块板同时糊在屏幕上。
 */
const Boards = ({
  view,
  stages,
  painted,
}: {
  view: React.MutableRefObject<View>;
  stages: React.MutableRefObject<Stage[]>;
  painted: React.MutableRefObject<boolean>;
}) => {
  const proj = useRef(new THREE.Vector3());
  const edge = useRef(new THREE.Vector3());
  const world = useRef(new THREE.Vector3());

  useFrame(({ camera, size }) => {
    const v = view.current;

    ROOMS.forEach((_, i) => {
      const s = stages.current[i];
      const el = s?.el;
      if (!el) return;

      // 只有「正在飞向的这颗」、且快到了，板子才露面
      const wanted =
        v.target === i ? THREE.MathUtils.smoothstep(v.progress, 0.6, 0.95) : 0;
      // 收的时候比放的时候快一点，避免换星球时两块板同时可见
      s.alpha += (wanted - s.alpha) * (wanted > s.alpha ? 0.12 : 0.28);

      if (s.alpha < 0.02) {
        if (el.style.visibility !== "hidden") {
          el.style.visibility = "hidden";
          el.style.pointerEvents = "none";
        }
        return;
      }

      world.current.copy(boardAnchor(i));

      proj.current.copy(world.current).project(camera);
      const cx = (proj.current.x * 0.5 + 0.5) * size.width;
      const cy = (-proj.current.y * 0.5 + 0.5) * size.height;

      // 用板子上沿的投影反推缩放：世界里的高度 ↔ DOM 里的像素高度
      edge.current.copy(world.current);
      edge.current.y += BOARD_H / 2;
      edge.current.project(camera);
      const heightPx =
        Math.abs(cy - (-edge.current.y * 0.5 + 0.5) * size.height) * 2;
      const scale = heightPx / BOARD_PX_H;

      // DOM 那块板躺在 .stage 左上角，算出它到目标位置的位移
      const dx = cx - (s.baseLeft + BOARD_PX_W / 2);
      const dy = cy - (s.baseTop + BOARD_PX_H / 2);

      el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(
        1
      )}px, 0) scale(${scale.toFixed(4)})`;
      el.style.opacity = s.alpha.toFixed(3);
      el.style.visibility = "visible";
      el.style.pointerEvents = "auto";
    });

    painted.current = true;
  });

  return null;
};

/**
 * 行星名牌：8 块真实 DOM 按钮，每帧被投影到各自行星的上方。
 * 用 DOM 而不是 3D 文字，是因为中文字形在 3D 里要么糊、要么得额外加载字体；
 * 而且做成按钮之后键盘 Tab 也能走到，不会把键盘用户困在星图上。
 *
 * 星图上 8 块牌子同在画面里，全靠缩放会挤成一团，所以这里用固定屏幕尺寸，
 * 只按远近做 ±15% 的微调 —— 名牌是导航用的文字，该保持恒定可读。
 */
const Plates = ({
  view,
  flight,
  plates,
  hovered,
  onEnter,
}: {
  view: React.MutableRefObject<View>;
  flight: React.MutableRefObject<Flight>;
  plates: React.MutableRefObject<(HTMLElement | null)[]>;
  hovered: number | null;
  onEnter: (index: number) => void;
}) => {
  const proj = useRef(new THREE.Vector3());
  const world = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());

  useFrame(({ camera, size }) => {
    const v = view.current;
    const inMap = v.target < 0 && !flight.current.active;

    ROOMS.forEach((room, i) => {
      const el = plates.current[i];
      if (!el) return;

      const alpha = inMap ? 1 : 0;
      const prev = Number(el.dataset.alpha ?? "0");
      const next = prev + (alpha - prev) * 0.16;
      el.dataset.alpha = String(next);
      el.style.opacity = next.toFixed(3);
      el.style.visibility = next < 0.02 ? "hidden" : "visible";
      el.style.pointerEvents = next < 0.5 ? "none" : "auto";
      if (next < 0.02) return;

      dir.current.set(Math.sin(room.angle), 0, Math.cos(room.angle));
      world.current
        .copy(dir.current)
        .multiplyScalar(R_ORBIT)
        .setY(PLATE_LIFT);

      proj.current.copy(world.current).project(camera);
      const cx = (proj.current.x * 0.5 + 0.5) * size.width;
      const cy = (-proj.current.y * 0.5 + 0.5) * size.height;

      const depth = camera.position.distanceTo(world.current);
      const scale = Math.min(1.14, Math.max(0.86, MAP_DIST / depth));

      el.style.transform = `translate(-50%, -50%) translate(${cx.toFixed(
        1
      )}px, ${cy.toFixed(1)}px) scale(${scale.toFixed(3)})`;
    });

    void hovered;
    void onEnter;
  });

  return null;
};

/* ---------------------------- 星系 ---------------------------- */

const Galaxy = ({
  view,
  flight,
  stages,
  plates,
  hovered,
  painted,
  onEnter,
}: {
  view: React.MutableRefObject<View>;
  flight: React.MutableRefObject<Flight>;
  stages: React.MutableRefObject<Stage[]>;
  plates: React.MutableRefObject<(HTMLElement | null)[]>;
  hovered: number | null;
  painted: React.MutableRefObject<boolean>;
  onEnter: (index: number) => void;
}) => (
  <>
    {/* 注意：这里**不能**给场景设背景色。
        设了之后画布就是一块不透明的底，底下那层真实星云照片会被整个盖住，
        只剩一片死黑的底色 —— 星云就只能靠画布自己画，也就是完全没有。 */}

    {/* 恒星从中心往外照，环境光兜住背阴面 ——
        只留恒星的话，从外侧看行星全是黑的（受光面朝内）。
        两盏都压得比之前暗：光太亮会把行星表面的纹样照成一坨纯色。 */}
    <ambientLight intensity={0.6} color="#7b8ad6" />
    <pointLight
      position={[0, 0, 0]}
      intensity={1.5}
      distance={220}
      decay={0}
      color="#ffd9a0"
    />
    <directionalLight position={[0, 42, 58]} intensity={0.26} color="#ffffff" />

    <Starfield />
    <Sun />
    <OrbitRing />

    {ROOMS.map((room, i) => (
      <Planet key={room.id} room={room} index={i} onEnter={onEnter} />
    ))}

    <Rig view={view} flight={flight} />
    <Boards view={view} stages={stages} painted={painted} />
    <Plates
      view={view}
      flight={flight}
      plates={plates}
      hovered={hovered}
      onEnter={onEnter}
    />
  </>
);

/* ---------------------------- 门槛判定 ---------------------------- */

/** 判断能不能跑 WebGL，探测用的上下文用完立刻释放，别白占一个名额 */
const detectWebGL = () => {
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
};

/* ------------------------------ 对外组件 ------------------------------ */

/**
 * 显卡驱动异常 / 上下文耗尽时 Canvas 会抛错，
 * 兜住它免得整个页面跟着白屏，出问题就退回静态背景。
 */
class SceneErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const Scene3D = () => {
  const [supported, setSupported] = useState(false);
  const [broken, setBroken] = useState(false);
  /** 已经停靠在哪颗行星；null = 停在星图上 */
  const [here, setHere] = useState<number | null>(null);
  const [flying, setFlying] = useState(false);
  /** 鼠标停在哪个名牌上：只影响名牌展开，不进渲染循环 */
  const [hovered, setHovered] = useState<number | null>(null);

  const view = useRef<View>({ target: -1, progress: 0, azimuth: 0 });
  const flight = useRef<Flight>({
    active: false,
    t: 0,
    dur: FLY_SECONDS,
    fromP: new THREE.Vector3(),
    toP: new THREE.Vector3(),
    viaP: null,
    fromL: new THREE.Vector3(),
    toL: new THREE.Vector3(),
    viaL: null,
    toRoom: -1,
  });

  const stages = useRef<Stage[]>(
    ROOMS.map(() => ({ el: null, baseLeft: 0, baseTop: 0, alpha: 0 }))
  );
  const plates = useRef<(HTMLElement | null)[]>(ROOMS.map(() => null));
  /** 渲染循环有没有真的跑起来（跑不起来就得退回普通排版） */
  const painted = useRef(false);
  const shade = useRef<HTMLDivElement>(null);

  const showScene = supported && !broken;

  /* 量 8 块解说板的布局位置。transform 先清掉再量，否则量到的是上一帧的结果 */
  const measure = useCallback(() => {
    ROOMS.forEach((room, i) => {
      const el = document.querySelector<HTMLElement>(`[data-board="${room.id}"]`);
      if (!el) return;
      el.style.transform = "none";
      const r = el.getBoundingClientRect();
      stages.current[i].el = el;
      stages.current[i].baseLeft = r.left;
      stages.current[i].baseTop = r.top;
    });
  }, []);

  /* 门槛：窗口够大、比例够宽、没关动效、取得到 WebGL。
     必须监听变化，不能只算一次 —— 否则把窗口从宽拖窄，3D 会赖着不走。 */
  useEffect(() => {
    const wideScreen = window.matchMedia("(min-width: 1024px)");
    const tallScreen = window.matchMedia("(min-height: 600px)");
    const wideRatio = window.matchMedia("(min-aspect-ratio: 13/10)");
    const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const sync = () => {
      const why: string[] = [];
      if (!wideScreen.matches)
        why.push(`窗口太窄（${window.innerWidth}px，至少要 1024）`);
      if (!tallScreen.matches)
        why.push(`窗口太矮（${window.innerHeight}px，至少要 600）`);
      if (!wideRatio.matches) why.push("窗口太接近方形（宽高比要 ≥ 1.3）");
      if (calmMotion.matches) why.push("系统开了「减少动态效果」");
      if (why.length === 0 && !detectWebGL()) why.push("浏览器取不到 WebGL");

      if (why.length) {
        // 留一行日志：出问题时按 F12 就能看到究竟卡在哪一条
        console.info(`[星系模式] 已退回普通排版 —— ${why.join("、")}`);
      }
      setSupported(why.length === 0);
    };

    sync();
    [wideScreen, tallScreen, wideRatio, calmMotion].forEach((q) =>
      q.addEventListener("change", sync)
    );
    window.addEventListener("resize", sync);
    return () => {
      [wideScreen, tallScreen, wideRatio, calmMotion].forEach((q) =>
        q.removeEventListener("change", sync)
      );
      window.removeEventListener("resize", sync);
    };
  }, []);

  /** 飞向第 index 颗行星 */
  const enter = useCallback((index: number) => {
    if (index < 0 || index >= ROOMS.length) return;
    const f = flight.current;
    // 飞行途中不接受新指令，免得两条路径打架
    if (f.active) return;
    const v = view.current;
    if (v.target === index) return;

    const fromDocked = v.target >= 0;
    f.active = true;
    f.t = 0;
    f.fromP = fromDocked ? dockPos(v.target) : mapPos(v.azimuth);
    f.fromL = fromDocked ? boardAnchor(v.target) : MAP_LOOK.clone();
    f.toP = dockPos(index);
    f.toL = boardAnchor(index);
    /* 已经停靠在某颗行星时再跳到另一颗：中间从星图上方绕一下，
       否则视线要横跨半个星系甩过去，人会晕。 */
    f.viaP = fromDocked ? mapPos(ROOMS[index].angle) : null;
    f.viaL = fromDocked ? MAP_LOOK.clone() : null;
    f.dur = fromDocked ? HOP_SECONDS : FLY_SECONDS;
    f.toRoom = index;

    // 从行星跳到行星时，把方位角挪到目标这边，之后回星图就落在这一侧
    if (fromDocked) v.azimuth = ROOMS[index].angle;

    v.target = index;
    v.progress = 0;
    setFlying(true);
    setHere(null);
  }, []);

  /** 回到星图 */
  const leave = useCallback(() => {
    const f = flight.current;
    if (f.active) return;
    const v = view.current;
    if (v.target < 0) return;

    f.active = true;
    f.t = 0;
    f.fromP = dockPos(v.target);
    f.fromL = boardAnchor(v.target);
    f.toP = mapPos(v.azimuth);
    f.toL = MAP_LOOK.clone();
    f.viaP = null;
    f.viaL = null;
    f.dur = FLY_SECONDS;
    f.toRoom = -1;

    v.target = -1;
    v.progress = 0;
    setFlying(true);
    setHere(null);
  }, []);

  /** 上一颗 / 下一颗 */
  const step = useCallback(
    (delta: number) => {
      const current = view.current.target;
      // 停在星图上时，「下一颗」从第一颗开始
      const from = current < 0 ? 0 : current;
      enter((from + delta + ROOMS.length) % ROOMS.length);
    },
    [enter]
  );

  /* 把导航权交出去：站内所有指着星球的 # 锚点、以及命令面板，都走 enterRoom */
  useEffect(() => {
    if (!showScene) return;
    return registerRoomEnter((roomId) => {
      const index = roomIndex(roomId);
      if (index >= 0) enter(index);
    });
  }, [showScene, enter]);

  /* spatial-on：板子脱离文档流，交给下面的投影脚本摆位。
     同时锁住滚动 —— 滚动已经不是导航手段，留着它只会让板子漂走。 */
  useEffect(() => {
    if (!showScene) return;
    document.documentElement.classList.add("spatial-on");
    measure();

    return () => {
      document.documentElement.classList.remove("spatial-on");
      stages.current.forEach((s) => {
        if (!s.el) return;
        s.el.style.visibility = "";
        s.el.style.transform = "";
        s.el.style.opacity = "";
        s.el.style.pointerEvents = "";
      });
      if (shade.current) shade.current.style.opacity = "";
      painted.current = false;
      view.current = { target: -1, progress: 0, azimuth: 0 };
      flight.current.active = false;
      setHere(null);
    };
  }, [showScene, measure]);

  /* 拦截站内所有指着星球的 # 锚点 ——
     导航栏、Hero 的「看看我的作品」都是这种链接，统一在这里转成「飞过去」，
     页面里各处的链接就一行都不用改。 */
  useEffect(() => {
    if (!showScene) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const id = anchor.getAttribute("href")!.slice(1);
      const index = roomIndex(id);
      if (index < 0) return;
      // 捕获阶段就拦掉，并且不让事件继续冒泡 ——
      // 导航栏用的是 next/link，它自己也会处理这个 # 锚点去滚动，
      // 不拦住的话两边会同时动手。
      event.preventDefault();
      event.stopPropagation();
      enter(index);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [showScene, enter]);

  /* 主循环：推进飞行进度 */
  useEffect(() => {
    if (!showScene) return;
    let raf = 0;
    let last = 0;

    const tick = () => {
      const now = performance.now();
      // 用真实间隔推进，掉帧时不会变慢；上限 50ms 防止切回标签页时一次跳完
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
      last = now;

      const f = flight.current;
      const v = view.current;

      if (f.active) {
        f.t = Math.min(1, f.t + dt / f.dur);
        v.progress = f.t;
        if (f.t >= 1) {
          f.active = false;
          v.target = f.toRoom;
          v.progress = f.toRoom >= 0 ? 1 : 0;
          setFlying(false);
          setHere(f.toRoom >= 0 ? f.toRoom : null);
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showScene]);

  /* 星图上滚轮绕星系公转；停靠时按 Esc 回星图 */
  useEffect(() => {
    if (!showScene) return;
    const onWheel = (event: WheelEvent) => {
      const v = view.current;
      if (v.target >= 0 || flight.current.active) return;
      event.preventDefault();
      v.azimuth += event.deltaY * 0.0016;
    };
    const onKey = (event: KeyboardEvent) => {
      const v = view.current;
      if (flight.current.active) return;
      if (event.key === "Escape" && v.target >= 0) leave();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [showScene, leave]);

  /* 渲染循环万一没跑起来（显卡抽风），把星系模式撤掉，别让正文一直藏着 */
  useEffect(() => {
    if (!showScene) return;
    const guard = window.setTimeout(() => {
      if (!painted.current) setBroken(true);
    }, 3000);
    return () => window.clearTimeout(guard);
  }, [showScene]);

  return (
    <>
      {/* 背景：真实星云照片 + 一层压暗暗角。这一层在 3D 没启用时也在，
          所以降级后的页面同样是宇宙调，不会突然变回一块纯色。 */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-0 overflow-hidden"
        style={{ backgroundColor: SPACE_COLOR }}
      >
        {/* 星云照片单开一层：提亮 + 加饱和，真实图片才真正看得见 */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "url(/space/space-bg.jpg)",
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "brightness(1.5) saturate(1.35)",
          }}
        />
        {/* 再压一层暗角，保证正文和名牌始终清楚 */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 8%, rgba(25,16,70,0.2) 0%, rgba(7,10,36,0.1) 45%, rgba(4,6,26,0.6) 100%)",
          }}
        />
        {showScene && (
          <SceneErrorBoundary>
            <Canvas
              dpr={[1, 1.75]}
              gl={{ antialias: true, powerPreference: "high-performance" }}
              camera={{ position: [0, MAP_HEIGHT, MAP_HORIZ], fov: 45, near: 0.1, far: 420 }}
              onCreated={({ gl }) => {
                // 上下文丢了就直接撤掉 3D，别让页面卡在一张黑画布上
                gl.domElement.addEventListener("webglcontextlost", (event) => {
                  event.preventDefault();
                  setBroken(true);
                });
              }}
            >
              <Galaxy
                view={view}
                flight={flight}
                stages={stages}
                plates={plates}
                hovered={hovered}
                painted={painted}
                onEnter={enter}
              />
            </Canvas>
          </SceneErrorBoundary>
        )}

        {/* 停靠到某颗行星时，一圈它的本色光晕从板子后面透出来 ——
            板子挡住了行星本体，这点光是「你确实到了那颗星球」的唯一提示。 */}
        {here !== null && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 62% 52% at 50% 50%, ${ROOMS[here].accent}38 0%, transparent 72%)`,
            }}
          />
        )}

        {/* 四周压暗一点：解说板是主角，星系只做背景 */}
        <div
          ref={shade}
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 78% 62% at 50% 52%, rgba(2,4,20,0.28) 0%, rgba(2,4,20,0.08) 55%, rgba(2,4,20,0.38) 100%)",
          }}
        />
      </div>

      {/* 交互层：行星名牌、星图提示、停靠导航。
          必须放在上面那层（z-0，自成层叠上下文）之外，才能压在正文（z-10）之上。 */}
      {showScene && (
        <div className="orbit-ui fixed inset-0 z-20">
          {ROOMS.map((room, i) => (
            <button
              key={room.id}
              type="button"
              ref={(el) => {
                plates.current[i] = el;
              }}
              className="orbit-plate"
              data-expanded={hovered === i}
              style={{ ["--plate-accent" as string]: room.accent }}
              onClick={() => enter(i)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered((h) => (h === i ? null : h))}
              aria-label={`飞向${room.label}：${roomBlurbs[room.id] ?? ""}`}
            >
              <span className="orbit-plate-top">
                <span className="orbit-plate-no">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="orbit-plate-name">{room.label}</span>
              </span>
              {/* 默认收起，指上去或键盘聚焦才展开 ——
                  8 块牌子同在星图上，常驻两行会挤成一团 */}
              <span className="orbit-plate-blurb">{roomBlurbs[room.id]}</span>
            </button>
          ))}

          {/* 星图提示：只在星图上显示 */}
          <div className="orbit-hint" data-hidden={flying || here !== null}>
            <span className="orbit-hint-line">
              滚轮绕着星系转一圈，点一颗星球进去
            </span>
            <button
              type="button"
              className="orbit-go-btn"
              onClick={() => enter(1)}
            >
              <FaRocket />
              直接去 · 作品星
            </button>
          </div>

          {/* 停靠后的导航 */}
          {here !== null && !flying && (
            <div className="orbit-nav">
              <button type="button" className="orbit-nav-btn" onClick={() => step(-1)}>
                <FaArrowLeft className="me-1.5" />
                上一颗
              </button>
              <button
                type="button"
                className="orbit-nav-btn orbit-nav-btn--back"
                onClick={leave}
              >
                回到星图
              </button>
              <span className="orbit-nav-label">
                {here + 1} / {ROOMS.length} · {ROOMS[here].label}
              </span>
              <button type="button" className="orbit-nav-btn" onClick={() => step(1)}>
                下一颗
                <FaArrowRight className="ms-1.5" />
              </button>
            </div>
          )}

          {flying && (
            <div className="orbit-nav">
              <span className="orbit-nav-label">正在前往…</span>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default Scene3D;
