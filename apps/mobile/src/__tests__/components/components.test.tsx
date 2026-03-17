import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import {
  Screen,
  Card,
  Pill,
  Button,
  SearchBar,
  EmptyState,
  LoadingState,
  StatusBadge,
  ProgressRing,
  RatingStars,
  FilterChips,
  SegmentedControl,
  Avatar,
  Badge,
  ListItem,
  ToggleSwitch,
  Divider,
  Skeleton,
  ErrorState,
} from '../../ui/components';

describe('UI Components', () => {
  describe('Screen', () => {
    it('should render children', () => {
      const { getByText } = render(
        <Screen title="Test">
          <Button text="Test Button" />
        </Screen>
      );
      expect(getByText('Test Button')).toBeTruthy();
    });
  });

  describe('Card', () => {
    it('should render title and subtitle', () => {
      const { getByText } = render(
        <Card title="Card Title" subtitle="Card Subtitle" />
      );
      expect(getByText('Card Title')).toBeTruthy();
      expect(getByText('Card Subtitle')).toBeTruthy();
    });

    it('should render children', () => {
      const { getByText } = render(
        <Card>
          <Button text="Child Button" />
        </Card>
      );
      expect(getByText('Child Button')).toBeTruthy();
    });

    it('should have accessible label when title provided', () => {
      const { getByLabelText } = render(
        <Card title="Accessible Card" subtitle="With subtitle" />
      );
      expect(getByLabelText('Accessible Card, With subtitle')).toBeTruthy();
    });
  });

  describe('Pill', () => {
    it('should render text', () => {
      const { getByText } = render(<Pill text="Badge Text" />);
      expect(getByText('Badge Text')).toBeTruthy();
    });

    it('should apply different styles for different kinds', () => {
      const kinds: Array<'default' | 'accent' | 'success' | 'muted' | 'danger' | 'warning'> = 
        ['default', 'accent', 'success', 'muted', 'danger', 'warning'];
      
      kinds.forEach((kind) => {
        const { getByText } = render(<Pill text={`${kind} pill`} kind={kind} />);
        expect(getByText(`${kind} pill`)).toBeTruthy();
      });
    });
  });

  describe('Button', () => {
    it('should render text', () => {
      const { getByText } = render(<Button text="Click Me" />);
      expect(getByText('Click Me')).toBeTruthy();
    });

    it('should call onPress when pressed', () => {
      const onPress = jest.fn();
      const { getByRole } = render(<Button text="Click Me" onPress={onPress} />);
      fireEvent.press(getByRole('button'));
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('should not call onPress when disabled', () => {
      const onPress = jest.fn();
      const { getByRole } = render(
        <Button text="Disabled" onPress={onPress} disabled />
      );
      fireEvent.press(getByRole('button'));
      expect(onPress).not.toHaveBeenCalled();
    });

    it('should show loading state', () => {
      const { getByText } = render(<Button text="Submit" loading />);
      expect(getByText('處理中...')).toBeTruthy();
    });

    it('should apply different sizes', () => {
      const sizes: Array<'small' | 'default' | 'large'> = ['small', 'default', 'large'];
      sizes.forEach((size) => {
        const { getByText } = render(<Button text={`${size} button`} size={size} />);
        expect(getByText(`${size} button`)).toBeTruthy();
      });
    });

    it('should apply different kinds', () => {
      const kinds: Array<'primary' | 'secondary' | 'danger'> = ['primary', 'secondary', 'danger'];
      kinds.forEach((kind) => {
        const { getByText } = render(<Button text={`${kind} button`} kind={kind} />);
        expect(getByText(`${kind} button`)).toBeTruthy();
      });
    });
  });

  describe('SearchBar', () => {
    it('should render with placeholder', () => {
      const { getByPlaceholderText } = render(
        <SearchBar value="" onChange={() => {}} placeholder="搜尋..." />
      );
      expect(getByPlaceholderText('搜尋...')).toBeTruthy();
    });

    it('should call onChange when text changes', () => {
      const onChange = jest.fn();
      const { getByPlaceholderText } = render(
        <SearchBar value="" onChange={onChange} placeholder="搜尋" />
      );
      fireEvent.changeText(getByPlaceholderText('搜尋'), 'test query');
      expect(onChange).toHaveBeenCalledWith('test query');
    });

    it('should show clear button when value is not empty', () => {
      const { getByLabelText } = render(
        <SearchBar value="test" onChange={() => {}} />
      );
      expect(getByLabelText('清除搜尋')).toBeTruthy();
    });

    it('should clear value when clear button is pressed', () => {
      const onChange = jest.fn();
      const { getByLabelText } = render(
        <SearchBar value="test" onChange={onChange} />
      );
      fireEvent.press(getByLabelText('清除搜尋'));
      expect(onChange).toHaveBeenCalledWith('');
    });
  });

  describe('EmptyState', () => {
    it('should render default content', () => {
      const { getByText } = render(<EmptyState />);
      expect(getByText('目前沒有資料')).toBeTruthy();
    });

    it('should render custom content', () => {
      const { getByText } = render(
        <EmptyState 
          title="沒有結果" 
          subtitle="找不到符合的項目" 
          hint="嘗試其他搜尋條件"
        />
      );
      expect(getByText('沒有結果')).toBeTruthy();
      expect(getByText('找不到符合的項目')).toBeTruthy();
      expect(getByText('嘗試其他搜尋條件')).toBeTruthy();
    });

    it('should render action button', () => {
      const onAction = jest.fn();
      const { getByText } = render(
        <EmptyState actionText="重新載入" onAction={onAction} />
      );
      fireEvent.press(getByText('重新載入'));
      expect(onAction).toHaveBeenCalled();
    });
  });

  describe('LoadingState', () => {
    it('should render loading state', () => {
      const { getByText } = render(<LoadingState />);
      expect(getByText('載入中')).toBeTruthy();
    });

    it('should render custom loading message', () => {
      const { getByText } = render(
        <LoadingState title="正在處理" subtitle="請稍候..." />
      );
      expect(getByText('正在處理')).toBeTruthy();
      expect(getByText('請稍候...')).toBeTruthy();
    });
  });

  describe('StatusBadge', () => {
    it('should render different statuses', () => {
      const statuses: Array<'open' | 'closed' | 'busy' | 'online' | 'offline'> = 
        ['open', 'closed', 'busy', 'online', 'offline'];
      
      statuses.forEach((status) => {
        const { getByText } = render(<StatusBadge status={status} />);
        expect(getByText).toBeTruthy();
      });
    });

    it('should render custom text', () => {
      const { getByText } = render(<StatusBadge status="open" text="營業至 22:00" />);
      expect(getByText('營業至 22:00')).toBeTruthy();
    });
  });

  describe('ProgressRing', () => {
    it('should render progress percentage', () => {
      const { getByText } = render(<ProgressRing progress={0.75} />);
      expect(getByText('75%')).toBeTruthy();
    });

    it('should clamp progress between 0 and 1', () => {
      const { getByText: getText1 } = render(<ProgressRing progress={1.5} />);
      expect(getText1('100%')).toBeTruthy();

      const { getByText: getText2 } = render(<ProgressRing progress={-0.5} />);
      expect(getText2('0%')).toBeTruthy();
    });
  });

  describe('RatingStars', () => {
    it('should render rating value', () => {
      const { getByText } = render(<RatingStars rating={4.5} />);
      expect(getByText('4.5')).toBeTruthy();
    });

    it('should be interactive when enabled', () => {
      const onChange = jest.fn();
      const { getAllByRole } = render(
        <RatingStars rating={3} interactive onChange={onChange} />
      );
      const buttons = getAllByRole('button');
      fireEvent.press(buttons[0]);
      expect(onChange).toHaveBeenCalledWith(1);
    });

    it('should have accessibility label', () => {
      const { getByLabelText } = render(<RatingStars rating={4} />);
      expect(getByLabelText('評分 4.0 星，滿分 5 星')).toBeTruthy();
    });
  });

  describe('FilterChips', () => {
    const options = [
      { key: 'all', label: '全部' },
      { key: 'active', label: '進行中' },
      { key: 'done', label: '已完成' },
    ];

    it('should render all options', () => {
      const { getByText } = render(
        <FilterChips options={options} selected={[]} onChange={() => {}} />
      );
      expect(getByText('全部')).toBeTruthy();
      expect(getByText('進行中')).toBeTruthy();
      expect(getByText('已完成')).toBeTruthy();
    });

    it('should call onChange with single selection', () => {
      const onChange = jest.fn();
      const { getByText } = render(
        <FilterChips options={options} selected={[]} onChange={onChange} />
      );
      fireEvent.press(getByText('進行中'));
      expect(onChange).toHaveBeenCalledWith(['active']);
    });

    it('should support multiple selection', () => {
      const onChange = jest.fn();
      const { getByText } = render(
        <FilterChips 
          options={options} 
          selected={['all']} 
          onChange={onChange} 
          multiple 
        />
      );
      fireEvent.press(getByText('進行中'));
      expect(onChange).toHaveBeenCalledWith(['all', 'active']);
    });
  });

  describe('SegmentedControl', () => {
    const options = [
      { key: 'tab1', label: '標籤一' },
      { key: 'tab2', label: '標籤二' },
    ];

    it('should render all options', () => {
      const { getByText } = render(
        <SegmentedControl options={options} selected="tab1" onChange={() => {}} />
      );
      expect(getByText('標籤一')).toBeTruthy();
      expect(getByText('標籤二')).toBeTruthy();
    });

    it('should call onChange when option is pressed', () => {
      const onChange = jest.fn();
      const { getByText } = render(
        <SegmentedControl options={options} selected="tab1" onChange={onChange} />
      );
      fireEvent.press(getByText('標籤二'));
      expect(onChange).toHaveBeenCalledWith('tab2');
    });

    it('should support string array options', () => {
      const onChange = jest.fn();
      const { getByText } = render(
        <SegmentedControl 
          options={['選項 A', '選項 B']} 
          selected={0} 
          onChange={onChange} 
        />
      );
      fireEvent.press(getByText('選項 B'));
      expect(onChange).toHaveBeenCalledWith(1);
    });
  });

  describe('Avatar', () => {
    it('should show initials for full name', () => {
      const { getByText } = render(<Avatar name="John Doe" />);
      expect(getByText('JD')).toBeTruthy();
    });

    it('should show single initial for single name', () => {
      const { getByText } = render(<Avatar name="John" />);
      expect(getByText('J')).toBeTruthy();
    });

    it('should show question mark for no name', () => {
      const { getByText } = render(<Avatar />);
      expect(getByText('?')).toBeTruthy();
    });
  });

  describe('Badge', () => {
    it('should render count', () => {
      const { getByText } = render(<Badge count={5} />);
      expect(getByText('5')).toBeTruthy();
    });

    it('should show max+ when count exceeds max', () => {
      const { getByText } = render(<Badge count={150} max={99} />);
      expect(getByText('99+')).toBeTruthy();
    });

    it('should not render when count is 0', () => {
      const { queryByText } = render(<Badge count={0} />);
      expect(queryByText('0')).toBeNull();
    });

    it('should render dot badge', () => {
      const { root } = render(<Badge count={0} dot />);
      expect(root).toBeTruthy();
    });
  });

  describe('ListItem', () => {
    it('should render title', () => {
      const { getByText } = render(<ListItem title="List Item" />);
      expect(getByText('List Item')).toBeTruthy();
    });

    it('should render subtitle', () => {
      const { getByText } = render(
        <ListItem title="Title" subtitle="Subtitle text" />
      );
      expect(getByText('Subtitle text')).toBeTruthy();
    });

    it('should call onPress when pressed', () => {
      const onPress = jest.fn();
      const { getByRole } = render(
        <ListItem title="Clickable" onPress={onPress} />
      );
      fireEvent.press(getByRole('button'));
      expect(onPress).toHaveBeenCalled();
    });

    it('should not be pressable when disabled', () => {
      const onPress = jest.fn();
      const { queryByRole } = render(
        <ListItem title="Disabled" onPress={onPress} disabled />
      );
      expect(queryByRole('button')).toBeNull();
    });
  });

  describe('ToggleSwitch', () => {
    it('should render in off state', () => {
      const { getByLabelText } = render(<ToggleSwitch value={false} />);
      expect(getByLabelText('關閉')).toBeTruthy();
    });

    it('should render in on state', () => {
      const { getByLabelText } = render(<ToggleSwitch value={true} />);
      expect(getByLabelText('開啟')).toBeTruthy();
    });

    it('should call onChange when toggled', () => {
      const onChange = jest.fn();
      const { getByRole } = render(
        <ToggleSwitch value={false} onChange={onChange} />
      );
      fireEvent.press(getByRole('switch'));
      expect(onChange).toHaveBeenCalledWith(true);
    });

    it('should not toggle when disabled', () => {
      const onChange = jest.fn();
      const { getByRole } = render(
        <ToggleSwitch value={false} onChange={onChange} disabled />
      );
      fireEvent.press(getByRole('switch'));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Divider', () => {
    it('should render without text', () => {
      const { root } = render(<Divider />);
      expect(root).toBeTruthy();
    });

    it('should render with text', () => {
      const { getByText } = render(<Divider text="或" />);
      expect(getByText('或')).toBeTruthy();
    });
  });

  describe('Skeleton', () => {
    it('should render with default dimensions', () => {
      const { root } = render(<Skeleton />);
      expect(root).toBeTruthy();
    });

    it('should render with custom dimensions', () => {
      const { root } = render(
        <Skeleton width={200} height={40} borderRadius={8} />
      );
      expect(root).toBeTruthy();
    });
  });

  describe('ErrorState', () => {
    it('should render with default error message', () => {
      const { getByText } = render(<ErrorState />);
      expect(getByText('發生錯誤')).toBeTruthy();
    });

    it('should render custom error message', () => {
      const { getByText } = render(
        <ErrorState 
          title="連線失敗" 
          subtitle="無法連接到伺服器" 
        />
      );
      expect(getByText('連線失敗')).toBeTruthy();
      expect(getByText('無法連接到伺服器')).toBeTruthy();
    });

    it('should render action button', () => {
      const onAction = jest.fn();
      const { getByText } = render(
        <ErrorState onAction={onAction} actionText="重試" />
      );
      fireEvent.press(getByText('重試'));
      expect(onAction).toHaveBeenCalled();
    });

    it('should show error code when showDetails is true', () => {
      const { getByText } = render(
        <ErrorState 
          errorCode="ERR_NETWORK" 
          showDetails 
        />
      );
      expect(getByText(/ERR_NETWORK/)).toBeTruthy();
    });
  });
});
