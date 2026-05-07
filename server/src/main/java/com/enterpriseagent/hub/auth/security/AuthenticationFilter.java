package com.enterpriseagent.hub.auth.security;

import java.io.IOException;
import java.util.List;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.auth.SessionService;

@Component
public class AuthenticationFilter extends OncePerRequestFilter {
    private final SessionService sessionService;

    public AuthenticationFilter(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            String token = header.substring("Bearer ".length()).trim();
            try {
                CurrentUser currentUser = sessionService.authenticate(token, request.getRemoteAddr(),
                        request.getHeader("User-Agent"), request.getHeader("X-Client-Version"));
                var authentication = new UsernamePasswordAuthenticationToken(currentUser, null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + currentUser.role().name())));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            } catch (Exception exception) {
                SecurityContextHolder.clearContext();
                request.setAttribute("eah.auth.failure", exception);
            }
        }
        try {
            filterChain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }
}
