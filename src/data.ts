export type Category = '外套' | '上装' | '下装' | '鞋履' | '配饰';
export type Garment = { id: string; name: string; en: string; category: Category; color: string; price: number; sprite?: number; essential?:number; statement?:number; image?: string; owned: boolean; reason: string; style: string; material: string };
export const garments: Garment[] = [
  { id:'oat', name:'燕麦色羊毛混纺西装', en:'The everyday blazer', category:'外套', color:'燕麦色', price:399, sprite:0, owned:true, reason:'柔和的中性色与你的阔腿裤自然衔接，适合轻松又得体的日常。',style:'都市轮廓',material:'羊毛混纺'},
  { id:'navy', name:'午夜蓝廓形西装', en:'The city blazer', category:'外套', color:'午夜蓝', price:429, sprite:1, owned:false, reason:'用深蓝替换燕麦色，为现有浅色内搭增加清晰层次，不必重买一整套。',style:'都市轮廓',material:'羊毛混纺'},
  { id:'trouser', name:'垂感高腰阔腿长裤', en:'The fluid trousers', category:'下装', color:'灰褐色', price:239, sprite:2, owned:true, reason:'平直舒展的裤线，平衡外套的体积感，也能搭配日常针织。',style:'都市轮廓',material:'垂感混纺'},
  { id:'bag', name:'半月形肩背包', en:'The half moon bag', category:'配饰', color:'浓咖色', price:269, sprite:3, owned:true, reason:'一抹深咖色把整套暖色连接起来，轻便轮廓很适合日常。',style:'复古学院',material:'皮质'},
  { id:'tee', name:'柔白圆领针织衫', en:'The everyday knit', category:'上装', color:'柔白色', price:159, essential:0, owned:true, reason:'简洁的内搭给外套留出空间，让配色保持轻盈。',style:'都市轮廓',material:'柔软针织'},
  { id:'jeans', name:'复古直筒牛仔裤', en:'The straight denim', category:'下装', color:'水洗蓝', price:199, essential:1, owned:true, reason:'水洗蓝让深色外套更休闲，用已有单品就能改变整套氛围。',style:'复古学院',material:'丹宁'},
  { id:'shoe', name:'经典棕色乐福鞋', en:'The everyday loafer', category:'鞋履', color:'暖棕色', price:329, essential:2, owned:true, reason:'暖棕色鞋面呼应配饰，让日常搭配保持利落。',style:'复古学院',material:'皮革'},
  { id:'camel', name:'柔暖流苏针织披肩', en:'The soft layer', category:'配饰', color:'奶油色', price:189, image:'/images/details.jpg', owned:false, reason:'柔软针织带来冬季层次，可以搭在现有外套上，与两条长裤继续搭配。',style:'复古学院',material:'针织'},
  { id:'cotton', name:'纯白圆领棉质T恤', en:'The cotton essential', category:'上装', color:'白色', price:89, image:'/images/tee-plain.jpg', owned:true, reason:'简洁的白色内搭，让外套和裤装的轮廓更清晰。',style:'都市轮廓',material:'棉质'},
  { id:'sneaker', name:'暖棕复古运动鞋', en:'The warm sneaker', category:'鞋履', color:'棕色', price:299, image:'/images/sneakers.jpg', owned:true, reason:'为日常组合增加休闲感，和暖色外套自然呼应。',style:'冬日户外',material:'皮革与织物'},
  { id:'scarf', name:'奶油色羊毛围巾', en:'The winter scarf', category:'配饰', color:'奶油色', price:129, essential:3, owned:false, reason:'给深蓝外套补一点明亮，也能与已有的燕麦色外套继续搭配。',style:'复古学院',material:'羊毛混纺'},
];
garments.push(
  {id:'red-knit',name:'樱桃红圆领针织衫',en:'A little cherry red',category:'上装',color:'樱桃红',price:229,statement:0,owned:true,reason:'用一抹红色给日常搭配提亮，与已有丹宁或中性色裤装组合。',style:'复古学院',material:'柔软针织'},
  {id:'lilac-cardigan',name:'浅紫色纽扣开衫',en:'The lilac cardigan',category:'外套',color:'浅紫色',price:259,statement:1,owned:true,reason:'轻松柔和的开衫，可围绕白色内搭尝试新的日常配色。',style:'复古学院',material:'针织'},
  {id:'mint-pants',name:'薄荷绿直筒长裤',en:'The mint trousers',category:'下装',color:'薄荷绿',price:199,statement:2,owned:true,reason:'清浅绿色搭配简单上衣，给衣橱带来一种不同的感觉。',style:'都市轮廓',material:'棉质混纺'},
  {id:'black-boots',name:'黑色厚底短靴',en:'The everyday boots',category:'鞋履',color:'黑色',price:399,statement:3,owned:false,reason:'用黑色短靴连接丹宁、长裤与冬季外套，先放进搭配比较。',style:'冬日户外',material:'皮革'}
);
export const styles = [
  {id:'city', name:'都市轮廓', en:'Soft structure', sub:'利落的线条，柔软的日常。', image:'/images/editorial.jpg', color:'#d8d9c9', tags:['中性色','舒展廓形','轻松叠穿'], description:'用自然的中性色和舒展线条，把一点利落融进日常。保留你熟悉的单品，尝试新的组合。'},
  {id:'college', name:'复古学院', en:'A familiar feeling', sub:'旧日灵感，新的穿法。', image:'/images/city.jpg', color:'#c9bea8', tags:['复古层次','丹宁','暖调配色'], description:'从针织、丹宁和暖调配色出发，让熟悉的衣服多一点故事感。风格可以轻松，也可以有自己的个性。'},
  {id:'outdoor', name:'冬日户外', en:'Out in the open', sub:'让舒适成为一种风格。', image:'/images/editorial.jpg', color:'#cbd3c1', tags:['实用层次','自然色','舒适轮廓'], description:'以舒适和实用为起点，试着把自然色与休闲单品组合起来。适合想多走一段路的日子。'},
];
export const categories: ('全部' | Category)[] = ['全部','外套','上装','下装','鞋履','配饰'];
export type Outfit = { coat: string; top: string; bottom: string; shoes: string; bag: string };
export type Slot = keyof Outfit;
export const slotNames: Record<Slot,string> = {coat:'外套',top:'上装',bottom:'下装',shoes:'鞋履',bag:'配饰'};
export const initialOutfit: Outfit = {coat:'oat',top:'tee',bottom:'trouser',shoes:'shoe',bag:'bag'};
export const itemById = (id:string) => garments.find(x=>x.id===id)!;
