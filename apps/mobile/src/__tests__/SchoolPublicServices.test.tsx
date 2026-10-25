import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Linking, TouchableOpacity } from 'react-native';
import { HealthScreen } from '../screens/HealthScreen';
import { UnavailableFeatureScreen } from '../screens/UnavailableFeatureScreen';

let mockSchool = { id: 'pu' };
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').getCurrentTheme() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'pu' };
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function pressHandlerForLabel(view: ReturnType<typeof render>, label: string) {
  return view.UNSAFE_getAllByType(TouchableOpacity).find((node) => {
    const child = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
    return child.some(
      (entry: { props?: { children?: string } } | string | null) =>
        entry && typeof entry === 'object' && entry.props?.children === label,
    );
  })?.props.onPress as (() => void) | undefined;
}

test('PU aliases keep detailed health links and open the centre site', async () => {
  mockSchool = { id: 'tw-pu' };
  const view = render(<HealthScreen />);
  expect(view.getByText('查看諮商申請方式')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('前往中心網站')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://osachc.pu.edu.tw/');
});

test('NCKU and NTPU health screens open verified offices; NTU uses student portal fallback', async () => {
  mockSchool = { id: 'ncku' };
  let view = render(<HealthScreen />);
  expect(view.getByText('成大心理健康與諮商輔導組')).toBeTruthy();
  expect(view.getByText('查看校方諮商服務與聯絡方式，預約請依校方流程辦理。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('在瀏覽器開啟')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://counseling-osa.ncku.edu.tw/');

  mockSchool = { id: 'ntpu' };
  view.rerender(<HealthScreen />);
  expect(view.getByText('北大學生諮商中心')).toBeTruthy();
  expect(view.getByText('查看校方諮商服務與聯絡方式，預約請依校方流程辦理。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('在瀏覽器開啟')));
  expect(Linking.openURL).toHaveBeenLastCalledWith('https://new.ntpu.edu.tw/osa/counseling');

  mockSchool = { id: 'ntu' };
  view.rerender(<HealthScreen />);
  expect(view.getByText('臺大學生專區（諮商資訊入口）')).toBeTruthy();
  expect(view.getByText('請在臺大學生專區查找諮商相關資訊。')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('在瀏覽器開啟')));
  expect(Linking.openURL).toHaveBeenLastCalledWith('https://www.ntu.edu.tw/student.html');
});

test('dormitory and career routes offer school official cards and switch with the school', async () => {
  mockSchool = { id: 'ncku' };
  const dorm = render(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  expect(dorm.getByText(/宿舍包裹查詢與線上報修尚未開放/)).toBeTruthy();
  await act(async () => fireEvent.press(dorm.getByText('前往成大住宿服務組')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://housing-osa.ncku.edu.tw/');
  expect(dorm.getByText(/來源：國立成功大學住宿服務組公開網站/)).toBeTruthy();

  mockSchool = { id: 'ntu' };
  dorm.rerender(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  expect(dorm.queryByText('前往成大住宿服務組')).toBeNull();
  expect(dorm.getByText('前往臺大學生專區（住宿資訊入口）')).toBeTruthy();

  mockSchool = { id: 'ntpu' };
  const career = render(<UnavailableFeatureScreen route={{ name: 'Career' }} />);
  expect(career.getByText(/職涯資料尚未連結到校方系統/)).toBeTruthy();
  await act(async () => fireEvent.press(career.getByText('前往北大職涯發展中心')));
  expect(Linking.openURL).toHaveBeenCalledWith('https://career.ntpu.edu.tw/cht/index.php');
});

test('public housing opens the PU office and a school without configured services gets no PU fallback', async () => {
  const view = render(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  await act(async () =>
    fireEvent.press(view.getByRole('button', { name: '前往靜宜住宿服務組官網' })),
  );
  expect(Linking.openURL).toHaveBeenCalledWith('https://osadorm.pu.edu.tw/');
  expect(view.getByRole('button', { name: '查看校方公告' })).toBeTruthy();

  mockSchool = { id: 'nchu' };
  view.rerender(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  expect(view.queryByText('前往靜宜住宿服務組官網')).toBeNull();
  expect(view.getByRole('button', { name: '查看校方公告' })).toBeTruthy();
});

test('duplicate taps do not issue a second open while one is pending', async () => {
  let resolve!: (value: unknown) => void;
  jest.mocked(Linking.openURL).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  mockSchool = { id: 'ncku' };
  const view = render(<UnavailableFeatureScreen route={{ name: 'Career' }} />);
  fireEvent.press(view.getByText('前往成大生涯發展與就業輔導組'));
  fireEvent.press(view.getByText('正在開啟…'));
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  await act(async () => resolve(undefined));
});

test('rejected opening recovers without exposing a URL', async () => {
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('offline'));
  mockSchool = { id: 'ncku' };
  const view = render(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  await act(async () => fireEvent.press(view.getByText('前往成大住宿服務組')));
  expect(Alert.alert).toHaveBeenCalledWith('無法開啟官網', '請確認網路連線後再試一次。');
  expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls[0])).not.toMatch(/https?:\/\//);
  await act(async () => fireEvent.press(view.getByText('前往成大住宿服務組')));
  expect(Linking.openURL).toHaveBeenCalledTimes(2);
});

test('stale dormitory and career onPress after school switch do not open the previous school URL', async () => {
  mockSchool = { id: 'ncku' };
  const dorm = render(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  const staleDorm = pressHandlerForLabel(dorm, '前往成大住宿服務組');
  expect(typeof staleDorm).toBe('function');
  mockSchool = { id: 'ntpu' };
  dorm.rerender(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  await act(async () => {
    staleDorm!();
  });
  expect(Linking.openURL).not.toHaveBeenCalled();

  mockSchool = { id: 'ncku' };
  const career = render(<UnavailableFeatureScreen route={{ name: 'Career' }} />);
  const staleCareer = pressHandlerForLabel(career, '前往成大生涯發展與就業輔導組');
  expect(typeof staleCareer).toBe('function');
  mockSchool = { id: 'ntu' };
  career.rerender(<UnavailableFeatureScreen route={{ name: 'Career' }} />);
  await act(async () => {
    staleCareer!();
  });
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('late dormitory and career failures after school switch do not alert the new school', async () => {
  let rejectDorm!: (error: Error) => void;
  jest.mocked(Linking.openURL).mockReturnValueOnce(
    new Promise((_, fail) => {
      rejectDorm = fail;
    }),
  );
  mockSchool = { id: 'ncku' };
  const dorm = render(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  fireEvent.press(dorm.getByText('前往成大住宿服務組'));
  mockSchool = { id: 'ntpu' };
  dorm.rerender(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  await act(async () => rejectDorm(new Error('offline')));
  expect(Alert.alert).not.toHaveBeenCalled();

  let rejectCareer!: (error: Error) => void;
  jest.mocked(Linking.openURL).mockReturnValueOnce(
    new Promise((_, fail) => {
      rejectCareer = fail;
    }),
  );
  mockSchool = { id: 'ncku' };
  const career = render(<UnavailableFeatureScreen route={{ name: 'Career' }} />);
  fireEvent.press(career.getByText('前往成大生涯發展與就業輔導組'));
  mockSchool = { id: 'ntu' };
  career.rerender(<UnavailableFeatureScreen route={{ name: 'Career' }} />);
  await act(async () => rejectCareer(new Error('offline')));
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('late health failure after school switch does not leak an error onto the new school', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(Linking.openURL).mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  mockSchool = { id: 'ncku' };
  const view = render(<HealthScreen />);
  fireEvent.press(view.getByText('在瀏覽器開啟'));
  mockSchool = { id: 'ntpu' };
  view.rerender(<HealthScreen />);
  expect(view.getByText('北大學生諮商中心')).toBeTruthy();
  await act(async () => reject(new Error('offline')));
  expect(view.queryByRole('alert')).toBeNull();
});
