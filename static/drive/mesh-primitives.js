import * as T from '../vendor/three.module.js';
export class MeshPrimitives {
  mat(color, metalness = 0.05, roughness = 0.6) {
    const key = [color, metalness, roughness].join('/');
    return (
      this.materials[key] ||
      (this.materials[key] = new T.MeshStandardMaterial({ color, metalness, roughness }))
    );
  }
  mesh(geo, mat, x, y, z, parent = this.scene) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  box(x, y, z, w, h, d, color, parent = this.scene) {
    const m = this.mesh(
      this.boxGeo,
      typeof color === 'object' ? color : this.mat(color),
      x,
      y + h / 2,
      z,
      parent,
    );
    m.scale.set(w, h, d);
    return m;
  }
  cylinder(x, y, z, r, h, color, parent = this.scene) {
    return this.mesh(
      new T.CylinderGeometry(r, r, h, 28),
      typeof color === 'object' ? color : this.mat(color),
      x,
      y + h / 2,
      z,
      parent,
    );
  }
  sphere(x, y, z, r, color, parent = this.scene) {
    const m = this.mesh(
      this.sphereGeo,
      typeof color === 'object' ? color : this.mat(color),
      x,
      y,
      z,
      parent,
    );
    m.scale.setScalar(r);
    return m;
  }
  tube(points, r, color, parent = this.scene) {
    const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p)));
    return this.mesh(
      new T.TubeGeometry(curve, 32, r, 8, false),
      this.mat(color, 0.65, 0.3),
      0,
      0,
      0,
      parent,
    );
  }
}
