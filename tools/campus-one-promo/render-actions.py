"""Edit REAL Playwright browser interaction recordings into a 9:16 short video.
The video window is always a recorded browser MP4/WebM, never a recreated UI or an old screenshot.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from datetime import datetime
import json, math, wave, subprocess, shutil
import numpy as np

ROOT=Path(__file__).resolve().parent
CAP=ROOT/'interactive'; OUT=ROOT/'output'; WORK=ROOT/'interactive-edits'
OUT.mkdir(parents=True,exist_ok=True); WORK.mkdir(parents=True,exist_ok=True)
REPORT=json.loads((CAP/'click_log.json').read_text(encoding='utf-8'))
W,H=1080,1920; FPS=30
FONT='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
FONT_BOLD='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
if not Path(FONT).exists():
    FONT='/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'
    FONT_BOLD='/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc'
if not Path(FONT).exists():
    FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    FONT_BOLD=FONT

def font(size,bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT,size,index=0)
def run(cmd):
    p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if p.returncode:
        raise RuntimeError(' '.join(map(str,cmd[:10]))+' -> '+p.stderr[-2500:])
    return p.stdout
def duration(p):
    return float(run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(p)]).strip())

def gradient():
    im=Image.new('RGB',(W,H)); pix=im.load()
    for y in range(H):
        a=y/H
        rgb=(int(12+a*9),int(31+a*12),int(31+a*8))
        for x in range(W): pix[x,y]=rgb
    return im.convert('RGBA')

def backdrop(kicker,line1,line2,lower,number=None,phone=True):
    image=gradient()
    overlay=Image.new('RGBA',(W,H),(0,0,0,0))
    d=ImageDraw.Draw(overlay)
    d.ellipse((660,-380,1400,450),fill=(54,164,131,53))
    d.ellipse((-580,1040,430,2070),fill=(60,111,128,34))
    overlay=overlay.filter(ImageFilter.GaussianBlur(130))
    image=Image.alpha_composite(image,overlay)
    d=ImageDraw.Draw(image)
    d.text((75,54),'C1',font=font(50,True),fill='#B9EFDD')
    d.text((178,69),'CAMPUS ONE',font=font(27,True),fill='#D2E9DF')
    d.line((75,137,1005,137),fill='#43695C',width=2)
    d.text((74,171),kicker,font=font(27,True),fill='#98DBBE')
    d.text((69,216),line1,font=font(65,True),fill='#F5F8F4')
    if line2: d.text((69,290),line2,font=font(52,True),fill='#D8E8E0')
    if phone:
        d.rounded_rectangle((182,353,898,1835),radius=77,fill=(1,12,13,110),outline='#57776B',width=3)
        d.rounded_rectangle((194,365,886,1818),radius=69,fill='#050D0E')
        d.rounded_rectangle((211,381,869,1808),radius=12,fill='#EDF1EC')
        d.ellipse((507,362,573,372),fill='#51645F')
        d.rectangle((77,1858,151,1865),fill='#8BE5B7')
        d.text((170,1839),lower,font=font(25),fill='#BBCEC4')
        if number:d.text((958,1838),number,font=font(23,True),fill='#AEC5B7',anchor='ra')
    else:
        d.line((79,570,998,570),fill='#40655B',width=2)
        d.rounded_rectangle((80,1450,1000,1575),radius=35,fill='#BDEDCF')
        d.text((130,1483),lower,font=font(40,True),fill='#123C32')
        d.text((85,1794),'MIIDUOA / GRADUATION    ·    2026.10.14',font=font(28),fill='#AACDBF')
    return image.convert('RGB')

def title_cards():
    im=backdrop('ACTUAL BROWSER RECORDING','不是截圖輪播。','這次真的點進去操作。','2026.10.14 · nuni.tw',phone=False)
    im.save(WORK/'intro.png',optimize=True)
    im=backdrop('TRY THE PRODUCT','Campus One','課務 × 校園生活','nuni.tw  ·  專案持續開發中',phone=False)
    im.save(WORK/'outro.png',optimize=True)
    im.save(OUT/'Campus_One_Interactive_Cover.jpg',quality=94)

SCENES={
    '01-bus': ('STEP 01   /   TRANSPORT','打開公車資訊','點擊站名搜尋','真實操作 · 公車入口'),
    '02-timetable': ('STEP 02   /   STUDY','進入個人課表','切換課表檢視','真實操作 · 課表介面'),
    '03-search': ('STEP 03   /   SEARCH','搜尋校園服務','從結果開啟功能','真實操作 · 服務查詢'),
    '04-campus': ('STEP 04   /   CAMPUS','探索校園地圖','點進找地點入口','真實操作 · 校園資訊'),
}

def image_segment(file,out,seconds):
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-loop','1','-framerate',str(FPS),'-i',str(file),
         '-t',str(seconds),'-vf',f'fps={FPS},format=yuv420p','-c:v','libx264',
         '-preset','veryfast','-crf','21','-pix_fmt','yuv420p',str(out)])

def composite(video,background,out,seconds):
    # Browser video is recorded at 786x1704; this segment displays every real frame.
    # In-device scale preserves exact page pixels/contents; only the edit's frame is designed.
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-ss','1.1','-i',str(video),
         '-loop','1','-framerate',str(FPS),'-i',str(background),
         '-filter_complex','[0:v]fps=30,scale=658:1427:flags=lanczos,setsar=1[screen];'
         '[1:v]format=rgba[bg];[bg][screen]overlay=x=211:y=381:shortest=1:format=auto,format=yuv420p[v]',
         '-map','[v]','-t',str(seconds),'-an','-c:v','libx264','-preset','veryfast','-crf','22',
         '-pix_fmt','yuv420p','-r',str(FPS),str(out)])

def soundtrack(seconds):
    sr=44100; n=int(seconds*sr); audio=np.zeros(n,np.float64)
    beat=60/112
    chords=[(164.81,196.0,246.94),(146.83,185,220.0),(174.61,220,261.63),(146.83,196,233.08)]
    rng=np.random.default_rng(104)
    def put(t,tones):
        index=int(t*sr)
        if index<0 or index>=n:return
        audio[index:index+min(len(tones),n-index)]+=tones[:min(len(tones),n-index)]
    def note(t,f,dur,volume):
        ts=np.arange(int(dur*sr))/sr
        env=np.minimum(1,ts*45)*np.exp(-ts*3.1)
        put(t,(np.sin(2*np.pi*f*ts)+.13*np.sin(4*np.pi*f*ts))*env*volume)
    for bar in range(math.ceil(seconds/(4*beat))):
        start=bar*4*beat
        f=chords[bar%4]
        for i in range(8):note(start+i*beat/2,f[(i+bar)%3],.32,.075)
        note(start,f[0]/2,1.7,.17)
    for i in range(math.ceil(seconds/beat)):
        t=i*beat
        ts=np.arange(int(sr*.20))/sr
        put(t,np.sin(2*np.pi*(63*ts-31*ts**2))*np.exp(-ts*28)*.28)
        if i%4 in (1,3):
            ts=np.arange(int(sr*.09))/sr
            put(t,rng.normal(size=len(ts))*np.exp(-ts*41)*.045)
    fade=min(int(.65*sr),n//5)
    audio[:fade]*=np.linspace(0,1,fade)
    audio[-fade:]*=np.linspace(1,0,fade)
    audio=np.tanh(audio*1.7)
    audio=.68*audio/max(1,np.max(abs(audio)))
    output=WORK/'soundtrack.wav'
    with wave.open(str(output),'wb') as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(sr)
        wav.writeframes((audio*32767).astype('<i2').tobytes())
    return output

def main():
    title_cards()
    valid=[]
    for chapter in REPORT['chapters']:
        video=ROOT/chapter.get('video_file','none')
        if chapter.get('valid_clicks',0)>=1 and video.is_file() and not chapter.get('critical_failure'):
            valid.append((chapter,video))
    if len(valid)<3 or sum(ch[0]['valid_clicks'] for ch in valid)<5:
        raise RuntimeError('Insufficient verified live click sequences - do not publish.')
    seq=[]; chapter_notes=[]; n=0
    intro=WORK/'s000-intro.mp4'
    image_segment(WORK/'intro.png',intro,2.3); seq.append(intro)
    for i,(chapter,video) in enumerate(valid,1):
        labels=SCENES.get(chapter['id'],('REAL SITE','實際網站操作','公開功能展示','nuni.tw'))
        background=WORK/(chapter['id']+'-background.png')
        backdrop(*labels,number=f'{i:02}/{len(valid):02}').save(background)
        raw_dur=duration(video)
        usable=max(1.5,raw_dur-1.1)
        if usable < 2.5: raise RuntimeError('Video too short to demonstrate interactions: '+str(video))
        edited=WORK/(chapter['id']+'-edit.mp4')
        composite(video,background,edited,usable)
        seq.append(edited)
        chapter_notes.append({'id':chapter['id'],'raw_video':str(video),'raw_seconds':round(raw_dur,2),
                              'edit_seconds':round(duration(edited),2),'clicks':chapter['valid_clicks'],
                              'verified_actions':[st['name'] for st in chapter['steps'] if st.get('ok')],
                              'final_url':chapter.get('final_url')})
        print('EDITED CHAPTER',chapter['id'],round(duration(edited),1),'seconds, clicks',chapter['valid_clicks'])
    outro=WORK/'s999-outro.mp4'
    image_segment(WORK/'outro.png',outro,3.2);seq.append(outro)
    playlist=WORK/'playlist.txt'
    playlist.write_text(''.join("file '"+str(p.resolve()).replace("'","'\\''")+"'\n" for p in seq))
    silent=WORK/'silent.mp4'
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',str(playlist),'-c','copy','-movflags','+faststart',str(silent)])
    total=duration(silent)
    music=soundtrack(total)
    dest=OUT/'Campus_One_2026-10-14_Real_Click_Demo.mp4'
    run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(silent),'-i',str(music),
         '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','160k',
         '-t',str(total),'-movflags','+faststart',str(dest)])
    if dest.stat().st_size<120000:raise RuntimeError('Rendered MP4 unexpectedly small.')
    (OUT/'INTERACTIVE_SOURCE.txt').write_text(
        'Campus One | 2026-10-14, Asia/Taipei\n'
        'This short video uses NEW LIVE browser recordings on https://nuni.tw/ with actual Playwright clicks and typed input.\n'
        'Not a screenshot slideshow. This is a public unauthenticated demonstration. Some backend data is not connected.\n'
        'Tap highlights are visual indicators synchronized with real clicks, not simulated UI behavior.\n'
        'Recorded browser segments and timestamped click log are in the associated ZIP artifact.\n'
        'Source repo https://github.com/Miiduoa/graduation\n'
        'Duration: %.2fs\n'%duration(dest),encoding='utf-8'
    )
    (OUT/'interactive_edit_manifest.json').write_text(json.dumps(
        {'source_date':'2026-10-14','source':'https://nuni.tw/','duration_seconds':round(duration(dest),2),
         'video_file':dest.name,'chapters':chapter_notes},ensure_ascii=False,indent=2),encoding='utf-8')
    print('FINAL MP4',dest,'BYTES',dest.stat().st_size,'DURATION',duration(dest))
if __name__=='__main__':main()
