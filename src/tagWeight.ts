/** タグの件数を 0〜1 の重みにする。件数の差は対数で効かせ、よく使うタグだけが極端に大きくならないようにする */
export function tagWeight(count: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return (Math.log(count) - Math.log(min)) / (Math.log(max) - Math.log(min));
}
