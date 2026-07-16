import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, screen } from '@testing-library/react';
import Footer from '../Footer';

jest.mock('react-gtm-module', () => ({
  __esModule: true,
  default: { initialize: jest.fn() },
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: null }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('Chat Footer', () => {
  it('does not render the default product and version footer', () => {
    render(<Footer startupConfig={{}} />);

    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });

  it('still renders an explicitly configured custom footer', () => {
    render(<Footer startupConfig={{ customFooter: 'Support center' }} />);

    expect(screen.getByRole('contentinfo')).toHaveTextContent('Support center');
  });
});
