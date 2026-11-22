"""Builds the plush moose, rigs it, animates Idle + Walk and exports public/moose.glb.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b -P blender/build_moose.py
Optional: append `-- --render out.png` to also render a preview still.

Conventions (Blender space): Z up, moose faces -Y, its left side is +X.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "moose.glb")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

# --------------------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30


def mat(name, color, rough=0.85, sheen=1.0, sheen_tint=(1, 1, 1, 1)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    if sheen:
        p.inputs["Sheen Weight"].default_value = sheen
        p.inputs["Sheen Roughness"].default_value = 0.4
        p.inputs["Sheen Tint"].default_value = sheen_tint
    return m


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


MATS = {
    "Fur": mat("Fur", srgb("#7b4720"), sheen_tint=(*srgb("#c98a4f"), 1)),
    "FurLight": mat("FurLight", srgb("#8f5627"), sheen_tint=(*srgb("#d9a066"), 1)),
    "Belly": mat("Belly", srgb("#d8c6a6"), sheen_tint=(*srgb("#fff3dc"), 1)),
    "Dark": mat("Dark", srgb("#3b2015"), sheen_tint=(*srgb("#8a5a40"), 1)),
    "Eye": mat("Eye", srgb("#0b0807"), rough=0.12, sheen=0),
}

parts = []  # (object, bone weights fn)


def ellipsoid(name, loc, radii, material, bone, rot=(0, 0, 0), seg=40, rings=24, shape=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1.0)
    ob = bpy.context.active_object
    ob.name = name
    me = ob.data
    for v in me.vertices:
        co = v.co.copy()
        if shape:
            co = shape(co)
        v.co = Vector((co.x * radii[0], co.y * radii[1], co.z * radii[2]))
    ob.rotation_euler = Euler([math.radians(a) for a in rot])
    ob.location = loc
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    me.materials.append(MATS[material])
    parts.append((ob, bone))
    return ob


# --------------------------------------------------------------------------- geometry
def pear(co):
    # wider at the bottom, slightly flatter front/back
    k = 1.0 + 0.16 * (-co.z)
    return Vector((co.x * k, co.y * k, co.z))


def foot_shape(co):
    # flatten the sole
    z = co.z if co.z > -0.55 else -0.55 - (co.z + 0.55) * 0.25
    return Vector((co.x, co.y, z))


SNOUT = dict(loc=Vector((0, -0.23, 0.76)), radii=Vector((0.175, 0.19, 0.14)), rot=Euler((math.radians(-12), 0, 0)))


def snout_surface(direction):
    """Point and outward normal where a ray from the snout centre hits its surface."""
    R = SNOUT["rot"].to_matrix()
    r = SNOUT["radii"]
    u = R.inverted() @ direction.normalized()
    t = 1 / math.sqrt(sum((u[i] / r[i]) ** 2 for i in range(3)))
    pl = u * t
    n = R @ Vector([pl[i] / r[i] ** 2 for i in range(3)])
    return SNOUT["loc"] + R @ pl, n.normalized()


# body + belly
ellipsoid("Body", (0, 0.0, 0.42), (0.235, 0.2, 0.27), "Fur", "BODY", shape=pear)
ellipsoid("Belly", (0, -0.12, 0.40), (0.185, 0.11, 0.215), "Belly", "BODY", shape=pear)
ellipsoid("Tail", (0, 0.2, 0.3), (0.05, 0.045, 0.05), "Fur", "hips", seg=20, rings=12)

for side, sx in (("L", 1), ("R", -1)):
    # legs + dark feet
    ellipsoid(f"Leg.{side}", (0.115 * sx, 0.0, 0.2), (0.095, 0.095, 0.13), "Fur", f"leg.{side}")
    ellipsoid(f"Foot.{side}", (0.118 * sx, -0.035, 0.062), (0.098, 0.125, 0.075), "Dark", f"leg.{side}",
              shape=foot_shape)
    # stubby arms hanging down/out
    ellipsoid(f"Arm.{side}", (0.255 * sx, -0.02, 0.47), (0.065, 0.07, 0.15), "Fur", f"arm.{side}",
              rot=(8, -32 * sx, 0))
    # ears, sideways and droopy
    ellipsoid(f"Ear.{side}", (0.215 * sx, 0.03, 0.88), (0.12, 0.04, 0.08), "Dark", f"ear.{side}",
              rot=(0, 20 * sx, -15 * sx), seg=24, rings=16)
    ellipsoid(f"EarIn.{side}", (0.215 * sx, 0.0, 0.88), (0.095, 0.022, 0.06), "Fur", f"ear.{side}",
              rot=(0, 20 * sx, -15 * sx), seg=24, rings=16)
    # eyes
    ellipsoid(f"Eye.{side}", (0.085 * sx, -0.165, 0.87), (0.02, 0.016, 0.024), "Eye", "head",
              seg=16, rings=10)
    # nostrils: thin dark patches sunk into the snout surface so they sit flush
    p, nrm = snout_surface(Vector((0.36 * sx, -1.0, -0.12)))
    q = Vector((0, 1, 0)).rotation_difference(nrm) @ Quaternion((0, 1, 0), math.radians(25 * sx))
    ellipsoid(f"Nostril.{side}", p - nrm * 0.0035, (0.017, 0.004, 0.011), "Dark", "head",
              rot=[math.degrees(a) for a in q.to_euler()], seg=16, rings=8)
    # antlers: stalk, palm, three rounded fingers
    ellipsoid(f"AntlerStalk.{side}", (0.1 * sx, 0.04, 0.99), (0.035, 0.035, 0.07), "Dark", f"antler.{side}",
              rot=(0, 25 * sx, 0), seg=16, rings=10)
    ellipsoid(f"AntlerPalm.{side}", (0.17 * sx, 0.05, 1.06), (0.11, 0.04, 0.055), "Dark", f"antler.{side}",
              rot=(0, -12 * sx, 0), seg=24, rings=14)
    for i, (fx, fz, ang) in enumerate(((0.09, 1.12, 5), (0.165, 1.135, -8), (0.24, 1.11, -25))):
        ellipsoid(f"AntlerTine{i}.{side}", (fx * sx, 0.05, fz), (0.036, 0.034, 0.065), "Dark", f"antler.{side}",
                  rot=(0, ang * sx, 0), seg=16, rings=10)

# head: cranium + huge snout
ellipsoid("Head", (0, -0.02, 0.86), (0.19, 0.18, 0.17), "Fur", "head")
ellipsoid("Snout", (0, -0.23, 0.76), (0.175, 0.19, 0.14), "FurLight", "head", rot=(-12, 0, 0))

# --------------------------------------------------------------------------- weights + join
for ob, bone in parts:
    if bone == "BODY":
        gh = ob.vertex_groups.new(name="hips")
        gs = ob.vertex_groups.new(name="spine")
        for v in ob.data.vertices:
            w = min(1.0, max(0.0, (v.co.z - 0.36) / 0.22))
            gh.add([v.index], 1 - w, "REPLACE")
            gs.add([v.index], w, "REPLACE")
    else:
        g = ob.vertex_groups.new(name=bone)
        g.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")

bpy.ops.object.select_all(action="DESELECT")
for ob, _ in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = parts[0][0]
bpy.ops.object.join()
moose = bpy.context.active_object
moose.name = "MooseMesh"

# --------------------------------------------------------------------------- armature
bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
rig = bpy.context.active_object
rig.name = "Moose"
arm = rig.data
arm.name = "MooseRig"
eb = arm.edit_bones
eb.remove(eb[0])


def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head, b.tail = head, tail
    b.roll = 0
    if parent:
        b.parent = eb[parent]
    return b


bone("root", (0, 0, 0), (0, -0.15, 0))
bone("hips", (0, 0, 0.26), (0, 0, 0.45), "root")
bone("spine", (0, 0, 0.45), (0, 0, 0.66), "hips")
bone("head", (0, 0, 0.66), (0, 0, 0.98), "spine")
for side, sx in (("L", 1), ("R", -1)):
    bone(f"leg.{side}", (0.115 * sx, 0, 0.28), (0.115 * sx, 0, 0.03), "hips")
    bone(f"arm.{side}", (0.2 * sx, -0.02, 0.57), (0.32 * sx, -0.02, 0.36), "spine")
    bone(f"ear.{side}", (0.13 * sx, 0.02, 0.9), (0.3 * sx, 0.03, 0.85), "head")
    bone(f"antler.{side}", (0.08 * sx, 0.04, 0.96), (0.17 * sx, 0.05, 1.12), "head")
bpy.ops.object.mode_set(mode="OBJECT")

moose.parent = rig
mod = moose.modifiers.new("Armature", "ARMATURE")
mod.object = rig

# --------------------------------------------------------------------------- animation helpers
REST = {b.name: b.matrix_local.to_3x3() for b in arm.bones}


def set_rot(pb, ax, ay, az):
    """Rotation given in armature-space axes (degrees), applied X then Y then Z."""
    r = Euler((math.radians(ax), math.radians(ay), math.radians(az)), "XYZ").to_matrix()
    rest = REST[pb.name]
    pb.rotation_quaternion = (rest.inverted() @ r @ rest).to_quaternion()


def set_loc(pb, x, y, z):
    pb.location = REST[pb.name].inverted() @ Vector((x, y, z))


def key_all(frame):
    for pb in rig.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("scale", frame=frame)


def reset_pose():
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
P = rig.pose.bones
TAU = math.tau
rig.animation_data_create()
actions = []


def make_action(name, frames, pose_fn):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    for f in range(frames + 1):
        reset_pose()
        pose_fn(f / frames)
        key_all(f + 1)
    actions.append(act)
    return act


# Walk: in-place bipedal waddle, one cycle = 24 frames (0.8 s)
def walk(t):
    s = math.sin(TAU * t)
    c = math.cos(TAU * t)
    swing = 30
    # legs: forward swing = negative rotation about +X (foot moves toward -Y)
    for side, ph in (("L", 0.0), ("R", 0.5)):
        sp = math.sin(TAU * (t + ph))
        cp = math.cos(TAU * (t + ph))
        lift = max(0.0, cp) ** 1.5
        set_rot(P[f"leg.{side}"], -swing * sp + 8 * lift, 0, 0)
        set_loc(P[f"leg.{side}"], 0, 0, 0.07 * lift)
    # arms swing opposite to legs, flapping out a bit
    for side, sx, ph in (("L", 1, 0.5), ("R", -1, 0.0)):
        sp = math.sin(TAU * (t + ph))
        set_rot(P[f"arm.{side}"], -28 * sp, 6 * sx * (1 + math.cos(TAU * (t + ph))), 0)
    # body: bob twice per cycle, waddle over the stance leg, twist with the hips
    set_loc(P["hips"], 0, 0, 0.022 * math.cos(2 * TAU * t) - 0.008)
    lean = -7 * c
    set_rot(P["hips"], -4, lean, 6 * s)
    set_rot(P["spine"], 2 * math.cos(2 * TAU * t), -lean * 0.35, -4 * s)
    set_rot(P["head"], 5 * math.cos(2 * TAU * t + 0.6) - 3, -lean * 0.5, -3 * s)
    # floppy bits lag behind
    for side, sx in (("L", 1), ("R", -1)):
        set_rot(P[f"ear.{side}"], 10 * math.sin(2 * TAU * t - 1.2), 14 * sx * math.sin(TAU * t - 1.0), 0)
        set_rot(P[f"antler.{side}"], 4 * math.sin(2 * TAU * t - 1.5), 5 * sx * math.sin(TAU * t - 1.3), 0)


# Idle: breathing, slow head tilt, ear flick, 72 frames (2.4 s)
def idle(t):
    br = math.sin(TAU * t)
    P["spine"].scale = (1 + 0.025 * br, 1 + 0.02 * br, 1 + 0.025 * br)
    set_loc(P["hips"], 0, 0, 0.004 * br)
    set_rot(P["head"], 3 * math.sin(TAU * t + 0.5), 6 * math.sin(TAU * t), 4 * math.sin(TAU * t + 1))
    for side, sx in (("L", 1), ("R", -1)):
        flick = math.exp(-((t - (0.3 if sx > 0 else 0.65)) * 18) ** 2)
        set_rot(P[f"ear.{side}"], 0, sx * (4 * br + 22 * flick), 0)
        set_rot(P[f"arm.{side}"], -3 * br, 3 * sx * br, 0)
        set_rot(P[f"antler.{side}"], 0, sx * 2 * math.sin(TAU * t - 0.5), 0)


make_action("Walk", 24, walk)
make_action("Idle", 72, idle)

# Push each action to its own NLA track so the exporter picks up both
rig.animation_data.action = None
for act in actions:
    tr = rig.animation_data.nla_tracks.new()
    tr.name = act.name
    st = tr.strips.new(act.name, 1, act)
    st.name = act.name
    tr.mute = True
reset_pose()
bpy.ops.object.mode_set(mode="OBJECT")

# --------------------------------------------------------------------------- preview render
if "--render" in ARGS:
    out_png = ARGS[ARGS.index("--render") + 1]
    pose_frame = ARGS[ARGS.index("--pose") + 1] if "--pose" in ARGS else None
    if pose_frame:
        rig.animation_data.action = bpy.data.actions["Walk"]
        scene.frame_set(int(pose_frame))
    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    view = ARGS[ARGS.index("--view") + 1] if "--view" in ARGS else "front"
    pos = {"front": (1.1, -2.6, 1.0), "side": (2.8, 0.0, 0.8), "back": (-1.2, 2.6, 1.0)}[view]
    cam.location = pos
    direction = Vector((0, 0, 0.6)) - Vector(pos)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = 50
    scene.camera = cam
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.rotation_euler = Euler((math.radians(50), 0, math.radians(30)))
    sun.data.energy = 4
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.6, 0.65, 0.7, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scene.world = world
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    sys.exit(0)

# --------------------------------------------------------------------------- export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_skins=True,
    export_yup=True,
    export_apply=False,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "moose.blend"))
print("EXPORTED", OUT)
