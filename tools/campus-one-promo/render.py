"""Campus One original 9:16 video, composed solely with newly captured live-site screenshots."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import json, wave, subprocess
import numpy as np

ROOT=Path(__file__).resolve().parent
CAP=ROOT/'capture'; OUT=ROOT/'output'; SC=ROOT/'scenes'
OUT.mkdir(exist_ok=True); SC.mkdir(exist_ok=True)
W,H=1080,1920
DATE='2026.10.14'
REG='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
BOLD='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
if not Path(REG).exists():
 REG='/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'
 BOLD='/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc'
if not Path(REG).exists():
 REG='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
 BOLD=REG
font=lambda n,b=False:ImageFont.truetype(BOLD if b else REG,n,index=0)

ALL_SCENES=[
 ('home','INTRO / 01',['不只是一個','校園 App。'],'把散落各處的資訊，重新整理成每一天的動線。','CAMPUS ONE'),
 ('home','YOUR DAY / 02',['打開首頁，','回到今天。'],'從「今天」開始，找到待辦與常用入口。','今日・課務・生活'),
 ('timetable','LEARNING / 03',['課表與課務，','放在一起。'],'課表、課程與成績的整合入口。','學習管理'),
 ('bus','CAMPUS LIFE / 04',['從教室到站牌，','接續每段行程。'],'公車資訊與校園生活的查詢入口。','交通與校園'),
 ('map','DISCOVER / 05',['想去的地方，','更容易找到。'],'校園地圖與服務選單，同一個平台。','校園地圖'),
 ('social','CONNECT / 06',['不只一間學校，','還有更多連結。'],'公開的跨校交流入口，探索校園之間的可能。','跨校交流'),
 ('search','CAMPUS ONE / 07',['Campus One','讓校園更順手。'],'現在就探索：nuni.tw','Miiduoa / graduation'),
]
SCENES=[x for x in ALL_SCENES if (CAP/(x[0]+'.png')).exists()]
def rounded(draw,xy,r,fill,outline=None,width=1):
 draw.rounded_rectangle(xy,radius=r,fill=fill,outline=outline,width=width)

def backdrop():
 im=Image.new('RGB',(W,H))
 d=ImageDraw.Draw(im)
 for y in range(H):
  t=y/H
  d.line((0,y,W,y),fill=(int(11-t*2),int(28-t*9),int(33-t*5)))
 cloud=Image.new('RGBA',(W,H),(0,0,0,0));dc=ImageDraw.Draw(cloud)
 dc.ellipse((510,-160,1460,850),fill=(41,192,173,83))
 dc.ellipse((-460,930,350,1760),fill=(67,123,168,56))
 dc.ellipse((700,1490,1430,2240),fill=(220,164,110,26))
 cloud=cloud.filter(ImageFilter.GaussianBlur(172))
 im=Image.alpha_composite(im.convert('RGBA'),cloud)
 d=ImageDraw.Draw(im)
 for r in [740,1100,1490]:
  d.ellipse((530-r/2,950-r/2,530+r/2,950+r/2),outline=(91,142,139,25),width=2)
 for xx in range(80,1050,50):
  for yy in range(170,1830,50):
   if (xx+yy//50)%4==0:d.ellipse((xx,yy,xx+2,yy+2),fill=(205,235,228,16))
 return im

def phone(canvas,key):
 photo=Image.open(CAP/(key+'.png')).convert('RGB')
 x0,y0,x1,y1=207,548,873,1694
 shadow=Image.new('RGBA',(W,H));ds=ImageDraw.Draw(shadow)
 rounded(ds,(x0-15,y0-5,x1+15,y1+36),84,(0,0,0,190))
 canvas=Image.alpha_composite(canvas,shadow.filter(ImageFilter.GaussianBlur(36)))
 d=ImageDraw.Draw(canvas)
 rounded(d,(x0-17,y0-17,x1+17,y1+17),82,(6,13,18,255),outline=(133,163,163,255),width=4)
 rounded(d,(x0-4,y0-4,x1+4,y1+4),73,(21,30,34,255))
 sx,sy,ex,ey=x0+20,y0+17,x1-20,y1-17
 # ImageOps.fit preserves original screenshot proportions; no redrawing of page content.
 inner=ImageOps.fit(photo,(ex-sx,ey-sy),method=Image.Resampling.LANCZOS)
 mask=Image.new('L',inner.size,0)
 ImageDraw.Draw(mask).rounded_rectangle((0,0,*inner.size),radius=54,fill=255)
 canvas.paste(inner,(sx,sy),mask)
 d=ImageDraw.Draw(canvas)
 rounded(d,(462,y0+16,618,y0+47),16,(7,13,17,255))
 d.ellipse((585,y0+26,595,y0+36),fill=(41,70,68,255))
 return canvas

def poster(i,item):
 key,kicker,lines,sub,pill=item
 im=backdrop();d=ImageDraw.Draw(im)
 d.text((82,90),'C / 1',font=font(54,True),fill=(123,238,208))
 d.line((218,129,1000,129),fill=(109,163,152,133),width=2)
 rounded(d,(80,184,475,247),30,(24,77,77,255),outline=(64,140,133,255),width=2)
 d.text((104,193),kicker,font=font(28,True),fill=(171,242,218))
 for j,line in enumerate(lines):
  fs=74 if len(line)>=9 else 81
  d.text((78,275+j*110),line,font=font(fs,True),fill=(247,251,246))
 im=phone(im,key)
 d=ImageDraw.Draw(im)
 rounded(d,(74,1480,471,1553),32,(218,248,235,250))
 d.text((100,1493),pill,font=font(30,True),fill=(12,55,52))
 rounded(d,(72,1740,1008,1842),24,(15,41,44,248),outline=(79,126,117,150),width=2)
 d.text((99,1762),sub,font=font(29),fill=(231,244,242))
 d.ellipse((81,1884,97,1900),fill=(124,229,199))
 d.text((112,1869),'LIVE SCREEN  ·  nuni.tw  ·  '+DATE,font=font(22,True),fill=(173,205,199))
 d.text((924,1869),f'{i+1:02}/{len(SCENES):02}',font=font(22,True),fill=(173,205,199))
 im.convert('RGB').save(SC/f'{i:02}.png',optimize=True)

def make_audio(seconds):
 sr=44100;count=int(seconds*sr);audio=np.zeros(count,dtype=np.float64)
 rng=np.random.default_rng(20261014);beat=60/122
 def put(start,data):
  pos=int(start*sr)
  if pos<0 or pos>=count:return
  n=min(len(data),count-pos)
  audio[pos:pos+n]+=data[:n]
 def note(t0,f,dur,vol):
  ts=np.arange(int(dur*sr))/sr
  sound=(np.sin(2*np.pi*f*ts)+.19*np.sin(4*np.pi*f*ts))*np.minimum(1,ts*38)*np.exp(-ts*2.8)*vol
  put(t0,sound)
 chords=[(220.,261.63,329.63),(174.61,220.,261.63),(196.,261.63,329.63),(196.,246.94,293.66)]
 for bar in range(int(seconds/(4*beat))+1):
  start=bar*4*beat;notes=chords[bar%4]
  for k in range(8):note(start+k*beat/2,notes[k%3],.37,.056)
  note(start,notes[0]/2,1.45,.17)
 for k in range(int(seconds/beat)+1):
  t0=k*beat;ts=np.arange(int(sr*.23))/sr
  put(t0,np.sin(2*np.pi*(70*ts-34*ts**2))*np.exp(-ts*26)*.24)
  if k%4 in (1,3):
   ts=np.arange(int(sr*.18))/sr
   put(t0,rng.normal(size=len(ts))*np.exp(-ts*36)*.065)
 for k in range(int(seconds/(beat/2))+1):
  ts=np.arange(int(sr*.09))/sr
  put(k*beat/2,rng.normal(size=len(ts))*np.exp(-ts*75)*.017)
 f=int(.7*sr);audio[:f]*=np.linspace(0,1,f)
 f=int(1.2*sr);audio[-f:]*=np.linspace(1,0,f)
 audio=np.tanh(audio*1.9);audio=.76*audio/max(1,np.max(abs(audio)))
 wav=OUT/'original_soundtrack.wav'
 with wave.open(str(wav),'wb') as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr)
  w.writeframes((audio*32767).astype('<i2').tobytes())
 return wav

def main():
 assert (CAP/'capture.json').exists(),'No live website capture evidence'
 meta=json.loads((CAP/'capture.json').read_text())
 assert len(SCENES)>=4,'Fewer than four newly captured live pages: refusing to fabricate visuals'
 assert (CAP/'home.png').exists(),'The live homepage was not captured'
 for i,item in enumerate(SCENES):poster(i,item)
 length=4.75;transition=.55;n=len(SCENES)
 total=round(n*length-(n-1)*transition,2)
 wav=make_audio(total)
 cmd=['ffmpeg','-hide_banner','-y','-loglevel','error']
 for i in range(n):
  cmd+=['-loop','1','-framerate','30','-t',str(length),'-i',str(SC/f'{i:02}.png')]
 cmd+=['-i',str(wav)]
 filters=[]
 for i in range(n):
  filters.append(f'[{i}:v]scale=720:1280,zoompan=z=\\'min(zoom+0.00012,1.032)\\':x=\\'iw/2-iw/zoom/2\\':y=\\'ih/2-ih/zoom/2\\':d=1:s=720x1280:fps=30,trim=duration={length},setpts=PTS-STARTPTS,fps=30,settb=AVTB,format=yuv420p[v{i}]')
 last='v0'
 for i in range(1,n):
  target=f'xf{i}'
  offset=round(i*(length-transition),2)
  filters.append(f'[{last}][v{i}]xfade=transition=fade:duration={transition}:offset={offset}[{target}]')
  last=target
 filters.append(f'[{last}]scale=1080:1920:flags=lanczos,format=yuv420p[vout]')
 name=OUT/'Campus_One_2026-10-14_Reel.mp4'
 cmd+=['-filter_complex',';'.join(filters),'-map','[vout]','-map',f'{n}:a','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','160k','-t',str(total),'-movflags','+faststart',str(name)]
 subprocess.run(cmd,check=True)
 assert name.stat().st_size>100000
 with open(OUT/'SOURCE_README.txt','w') as f:
  f.write(f'Campus One reel | {DATE}\nSource: newly captured public pages at https://nuni.tw/\nRepo: https://github.com/Miiduoa/graduation\nVideo: H264 1080x1920 30fps, {total}s\nCaptures: {len(meta["captures"])} URL rows\nOriginal synthesized soundtrack. No simulated product UI. Public access only; account-bound features not verified by this recording.\n')
 print('OUTPUT:',name, 'SIZE:',name.stat().st_size,'DURATION:',total)
if __name__=='__main__':main()
